import { Module } from '@nestjs/common';
import { NotificationGatewayModule } from './gateway/notification-gateway.module';

@Module({
  imports: [NotificationGatewayModule],
})
export class AppModule {}
