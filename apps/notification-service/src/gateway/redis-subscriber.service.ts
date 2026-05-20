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
    this.subscriber.subscribe(FARMER_NOTIFICATIONS_CHANNEL, (err, count) => {
      if (err) {
        this.logger.error('Failed to subscribe to Redis channel', err);
        return;
      }
      this.logger.log(
        `Subscribed to ${count} Redis channel(s): ${FARMER_NOTIFICATIONS_CHANNEL}`,
      );
    });

    this.subscriber.on('message', (_channel: string, message: string) => {
      this.handleMessage(message);
    });
  }

  onModuleDestroy() {
    this.subscriber.disconnect();
  }

  private handleMessage(rawMessage: string): void {
    let payload: FarmerNotificationPayload;
    try {
      payload = JSON.parse(rawMessage) as FarmerNotificationPayload;
    } catch {
      this.logger.warn(`Received malformed message: ${rawMessage}`);
      return;
    }

    this.notificationGateway.notifyFarmer(payload);
  }
}
