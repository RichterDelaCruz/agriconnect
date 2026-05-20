import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Farmer, Product } from '@agriconnect/database';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';

@Module({
  imports: [TypeOrmModule.forFeature([Farmer, Product])],
  controllers: [CatalogController],
  providers: [CatalogService],
})
export class CatalogModule {}
