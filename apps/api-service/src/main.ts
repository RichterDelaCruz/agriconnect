import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/**
 * AgriConnect API Service — Entry Point
 *
 * Bootstraps the NestJS application with:
 * - Global route prefix: /api/v1
 * - PostgreSQL connection via TypeORM
 * - Redis pub/sub integration
 *
 * Endpoints:
 *   GET  /api/v1/catalog/farmers          — paginated farmer listing
 *   GET  /api/v1/catalog/farmers/:id/products — farmer products
 *   POST /api/v1/requests                  — create purchase request
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');
  await app.listen(process.env.PORT ?? 3000);
}

bootstrap();
