import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product, Request, RequestItem } from '@agriconnect/database';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';

/**
 * Requests Module — handles distributor purchase request creation.
 *
 * Registers:
 * - TypeORM repositories for Request, RequestItem, and Product entities
 * - RequestsController (route: POST /api/v1/requests)
 * - RequestsService (business logic: transactional creation, Redis publish)
 *
 * Relies on the Global RedisModule for the Redis publisher client.
 * Imported by: AppModule
 */
@Module({
  imports: [TypeOrmModule.forFeature([Request, RequestItem, Product])],
  controllers: [RequestsController],
  providers: [RequestsService],
})
export class RequestsModule {}
