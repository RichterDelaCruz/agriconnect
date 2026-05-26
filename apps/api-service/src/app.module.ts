import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Distributor,
  Farmer,
  Product,
  Request,
  RequestItem,
} from '@agriconnect/database';
import { CatalogModule } from './catalog/catalog.module';
import { RequestsModule } from './requests/requests.module';
import { RedisModule } from './redis/redis.module';

/**
 * API Service — Root Application Module
 *
 * Wires together the entire REST API:
 * - TypeORM: connects to PostgreSQL using env vars (DB_HOST, DB_PORT, etc.)
 *   with `synchronize: false` (migrations are run manually)
 * - RedisModule: global Redis publisher for notifications
 * - CatalogModule: farmer/product browsing (GET /api/v1/catalog/*)
 * - RequestsModule: distributor request creation (POST /api/v1/requests)
 *
 * Listen on: http://localhost:3000
 */
@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST ?? 'localhost',
      port: parseInt(process.env.DB_PORT ?? '5432', 10),
      username: process.env.DB_USER ?? 'postgres',
      password: process.env.DB_PASSWORD ?? 'postgres',
      database: process.env.DB_NAME ?? 'agriconnect',
      entities: [Distributor, Farmer, Product, Request, RequestItem],
      synchronize: false,
    }),
    RedisModule,
    CatalogModule,
    RequestsModule,
  ],
})
export class AppModule {}
