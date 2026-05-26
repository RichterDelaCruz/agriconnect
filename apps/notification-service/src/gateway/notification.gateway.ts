import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { FarmerNotificationPayload } from '@agriconnect/common';

/**
 * WebSocket Gateway — Real-Time Notification Delivery
 *
 * Each farmer client connects and registers their farmerId by emitting
 * a `register` event. The gateway maps farmerId → socket.id so that
 * when the RedisSubscriberService receives a pub/sub message, it can
 * look up the correct socket and emit directly to that farmer.
 *
 * Horizontal scaling: because multiple instances of this service run
 * concurrently behind a load balancer (with sticky sessions), the
 * Redis Pub/Sub fan-out ensures that even if the originating HTTP
 * request landed on Instance A, the farmer's WebSocket connection on
 * Instance B will still receive the notification.
 */
@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/notifications',
})
export class NotificationGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(NotificationGateway.name);

  /** Maps farmerId → socket.id for O(1) lookup */
  private readonly farmerSocketMap = new Map<string, string>();

  handleConnection(client: Socket) {
    // Called automatically by Socket.IO when a new WebSocket connects.
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    // Called automatically when a client disconnects (closes browser, loses network, etc.)
    this.logger.log(`Client disconnected: ${client.id}`);

    // Cleanup: remove this socket's farmerId from the map.
    // We iterate through all entries to find which farmerId is mapped to this socket.
    // Without this cleanup, we'd try to emit to a stale socket later.
    for (const [farmerId, socketId] of this.farmerSocketMap.entries()) {
      if (socketId === client.id) {
        this.farmerSocketMap.delete(farmerId);
        this.logger.log(`Deregistered farmer ${farmerId}`);
        break;
      }
    }
  }

  /**
   * Called by the farmer client AFTER connecting, via:
   *   socket.emit('register', { farmerId: 1 })
   *
   * This binds the farmer's logical ID to their physical socket connection,
   * so we know where to deliver notifications later.
   */
  @SubscribeMessage('register')
  handleRegister(
    @MessageBody() data: { farmerId: string },
    @ConnectedSocket() client: Socket,
  ) {
    // Store the mapping: farmerId → socket.id
    // Later, notifyFarmer() looks up this map to find which socket to emit to.
    this.farmerSocketMap.set(data.farmerId, client.id);
    this.logger.log(`Farmer ${data.farmerId} registered on socket ${client.id}`);

    // Send an acknowledgement back to the client so they know registration succeeded.
    return { event: 'registered', data: { farmerId: data.farmerId } };
  }

  /**
   * Called by RedisSubscriberService after it receives a pub/sub message.
   *
   * Flow: Redis message → RedisSubscriberService → this.notifyFarmer()
   *
   * If the farmer is NOT connected to THIS instance (e.g. they're on Instance B),
   * we silently do nothing — the other instance will handle it via the same
   * pub/sub fan-out.
   */
  notifyFarmer(payload: FarmerNotificationPayload): void {
    // --- Step 1: Look up which socket this farmer is connected to ---
    const socketId = this.farmerSocketMap.get(payload.farmerId);

    // --- Step 2: If not found on this instance, silently ignore ---
    // This is expected in horizontal scaling: farmer might be on another instance.
    // The Redis Pub/Sub fan-out ensures ALL instances get the message,
    // so the correct one will find the socket and deliver it.
    if (!socketId) {
      this.logger.log(
        `Farmer ${payload.farmerId} not on this instance — skipping`,
      );
      return;
    }

    // --- Step 3: Emit the 'new_request' event directly to that socket ---
    // Socket.IO routes the event only to this specific socket (not broadcast).
    // The farmer client listens for 'new_request' and shows a notification.
    this.server.to(socketId).emit('new_request', payload);
    this.logger.log(
      `Notified farmer ${payload.farmerId} about request ${payload.requestId}`,
    );
  }
}
