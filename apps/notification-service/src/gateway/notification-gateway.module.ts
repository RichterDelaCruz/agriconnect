import { Module } from '@nestjs/common';
import { NotificationGateway } from './notification.gateway';
import { RedisSubscriberService } from './redis-subscriber.service';

@Module({
  providers: [NotificationGateway, RedisSubscriberService],
})
export class NotificationGatewayModule {}
