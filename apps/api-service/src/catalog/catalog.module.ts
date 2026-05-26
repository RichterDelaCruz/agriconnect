import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Farmer, Product } from '@agriconnect/database';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';

/**
 * Catalog Module — encapsulates the farmer and product browsing feature.
 *
 * Registers:
 * - TypeORM repositories for Farmer and Product entities
 * - CatalogController (routes: GET /api/v1/catalog/*)
 * - CatalogService (business logic: pagination, CDN prefix, stock filtering)
 *
 * Imported by: AppModule
 */
@Module({
  imports: [TypeOrmModule.forFeature([Farmer, Product])],
  controllers: [CatalogController],
  providers: [CatalogService],
})
export class CatalogModule {}
