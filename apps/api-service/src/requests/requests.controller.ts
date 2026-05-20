import { Body, Controller, Post } from '@nestjs/common';
import { RequestsService } from './requests.service';
import { CreateRequestDto } from '@agriconnect/common';

@Controller('requests')
export class RequestsController {
  constructor(private readonly requestsService: RequestsService) {}

  @Post()
  createRequests(@Body() dto: CreateRequestDto) {
    return this.requestsService.createRequests(dto);
  }
}
