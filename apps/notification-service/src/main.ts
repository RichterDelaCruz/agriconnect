import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // HTTP port is secondary; WebSocket is served on the same port via Socket.IO
  await app.listen(process.env.PORT ?? 3001);
}

bootstrap();
