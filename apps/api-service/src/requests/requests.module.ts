import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product, Request, RequestItem } from '@agriconnect/database';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';

@Module({
  imports: [TypeOrmModule.forFeature([Request, RequestItem, Product])],
  controllers: [RequestsController],
  providers: [RequestsService],
})
export class RequestsModule {}
