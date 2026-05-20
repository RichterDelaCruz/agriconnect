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
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    // Remove the farmer registration when the socket closes
    for (const [farmerId, socketId] of this.farmerSocketMap.entries()) {
      if (socketId === client.id) {
        this.farmerSocketMap.delete(farmerId);
        this.logger.log(`Deregistered farmer ${farmerId}`);
        break;
      }
    }
  }

  /**
   * Farmers call this once after connecting to bind their identity
   * to the socket session.
   */
  @SubscribeMessage('register')
  handleRegister(
    @MessageBody() data: { farmerId: string },
    @ConnectedSocket() client: Socket,
  ) {
    this.farmerSocketMap.set(data.farmerId, client.id);
    this.logger.log(`Farmer ${data.farmerId} registered on socket ${client.id}`);
    return { event: 'registered', data: { farmerId: data.farmerId } };
  }

  /**
   * Called by RedisSubscriberService after receiving a pub/sub message.
   * Emits the notification payload directly to the farmer's socket if
   * that farmer is connected to this instance.
   */
  notifyFarmer(payload: FarmerNotificationPayload): void {
    const socketId = this.farmerSocketMap.get(payload.farmerId);
    if (!socketId) {
      // Farmer is connected to a different instance — the pub/sub fan-out
      // ensures that instance will handle delivery.
      return;
    }

    this.server.to(socketId).emit('new_request', payload);
    this.logger.log(
      `Notified farmer ${payload.farmerId} about request ${payload.requestId}`,
    );
  }
}
