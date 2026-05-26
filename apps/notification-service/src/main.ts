import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/**
 * AgriConnect Notification Service — Entry Point
 *
 * Bootstraps a standalone WebSocket server. Unlike the API service,
 * this service has NO REST endpoints — it only serves Socket.IO
 * connections on the /notifications namespace.
 *
 * Flow: Redis Pub/Sub ← API Service publishes → Notification Gateway
 *       → WebSocket → Connected Farmer Client
 *
 * Listen on: http://localhost:3001
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // HTTP port is secondary; WebSocket is served on the same port via Socket.IO
  await app.listen(process.env.PORT ?? 3001);
}

bootstrap();
