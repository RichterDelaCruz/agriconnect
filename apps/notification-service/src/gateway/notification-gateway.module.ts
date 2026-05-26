import { Module } from '@nestjs/common';
import { NotificationGateway } from './notification.gateway';
import { RedisSubscriberService } from './redis-subscriber.service';

/**
 * Notification Gateway Module — real-time WebSocket notification delivery.
 *
 * Registers:
 * - NotificationGateway — Socket.IO WebSocket server at /notifications namespace
 * - RedisSubscriberService — subscribes to `farmer_notifications` channel and
 *   forwards messages to the gateway for WebSocket delivery
 *
 * Architecture: Redis Pub/Sub fans out notifications to all service instances.
 * The instance holding the target farmer's socket connection delivers the WS frame;
 * other instances silently no-op.
 *
 * Imported by: AppModule (notification-service)
 */
@Module({
  providers: [NotificationGateway, RedisSubscriberService],
})
export class NotificationGatewayModule {}
