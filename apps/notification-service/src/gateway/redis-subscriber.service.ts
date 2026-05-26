import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import { FarmerNotificationPayload } from '@agriconnect/common';
import { NotificationGateway } from './notification.gateway';

export const FARMER_NOTIFICATIONS_CHANNEL = 'farmer_notifications';

/**
 * Redis Subscriber Service — Pub/Sub Bridge to WebSocket
 *
 * This service subscribes to the `farmer_notifications` Redis channel.
 * Every notification-service instance subscribes independently; the
 * instance whose `NotificationGateway` holds the target farmer's
 * socket connection will actually emit the WS frame — others silently
 * no-op (socket not found in local map).
 *
 * A dedicated `subscriber` Redis connection is created because a
 * connection in subscribe mode cannot issue regular commands.
 */
@Injectable()
export class RedisSubscriberService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisSubscriberService.name);
  private readonly subscriber: Redis;

  constructor(private readonly notificationGateway: NotificationGateway) {
    this.subscriber = new Redis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    });
  }

  onModuleInit() {
    // --- Step 1: Subscribe to the Redis channel ---
    // Called automatically by NestJS when the module starts.
    // We subscribe to `farmer_notifications` — the same channel that
    // the API service's RequestsService publishes to.
    this.subscriber.subscribe(FARMER_NOTIFICATIONS_CHANNEL, (err, count) => {
      if (err) {
        this.logger.error('Failed to subscribe to Redis channel', err);
        return;
      }
      this.logger.log(
        `Subscribed to ${count} Redis channel(s): ${FARMER_NOTIFICATIONS_CHANNEL}`,
      );
    });

    // --- Step 2: Listen for incoming messages ---
    // Redis pushes messages to all subscribers in real-time.
    // Every notification-service instance receives EVERY message
    // (this is how Pub/Sub works — fan-out to all subscribers).
    this.subscriber.on('message', (_channel: string, message: string) => {
      this.handleMessage(message);
    });
  }

  onModuleDestroy() {
    // Clean up the Redis connection when the service shuts down.
    // Called by NestJS when the module is destroyed (e.g., during graceful shutdown).
    this.logger.log('Disconnecting Redis subscriber...');
    this.subscriber.disconnect();
  }

  /**
   * Process a raw message from the Redis channel.
   *
   * The message is a JSON string published by RequestsService in the API service.
   * We parse it and forward it to the NotificationGateway.
   *
   * If the JSON is malformed, we log a warning and ignore it —
   * we don't want a single bad message to crash the service.
   */
  private handleMessage(rawMessage: string): void {
    let payload: FarmerNotificationPayload;

    // --- Step 1: Parse the JSON message ---
    // The publisher sends: JSON.stringify({ farmerId, requestId, message })
    // We need to parse it back into an object.
    try {
      payload = JSON.parse(rawMessage) as FarmerNotificationPayload;
    } catch {
      // If JSON.parse fails (e.g. garbage data on the channel, or a bug),
      // log a warning and skip — don't crash the entire service.
      this.logger.warn(`Received malformed message: ${rawMessage}`);
      return;
    }

    // --- Step 2: Forward to the WebSocket gateway ---
    // The gateway checks if this farmer is connected to THIS instance.
    // If yes → emits the notification via WebSocket.
    // If no → silently ignores (another instance will handle it).
    this.notificationGateway.notifyFarmer(payload);
  }
}
