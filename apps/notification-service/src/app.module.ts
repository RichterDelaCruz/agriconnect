import { Module } from '@nestjs/common';
import { NotificationGatewayModule } from './gateway/notification-gateway.module';

/**
 * Notification Service — Root Application Module
 *
 * The notification-service has no REST endpoints. It is a standalone
 * WebSocket server that subscribes to Redis Pub/Sub and pushes
 * real-time notifications to connected farmers via Socket.IO.
 *
 * Imported modules:
 * - NotificationGatewayModule: WebSocket gateway + Redis subscriber
 *
 * Listen on: http://localhost:3001 (WebSocket at /notifications namespace)
 */
@Module({
  imports: [NotificationGatewayModule],
})
export class AppModule {}
