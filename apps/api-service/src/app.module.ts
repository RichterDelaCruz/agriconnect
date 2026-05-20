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
