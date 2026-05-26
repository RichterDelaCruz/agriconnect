import { Body, Controller, Post } from '@nestjs/common';
import { RequestsService } from './requests.service';
import { CreateRequestDto } from '@agriconnect/common';

/**
 * Requests Controller — Endpoints for distributors to create purchase
 * requests directed at one or more farmers.
 *
 * This is the concurrency-critical path: `createRequests()` uses a
 * database transaction with `SELECT FOR UPDATE` to prevent overselling
 * when multiple distributors buy the same product simultaneously.
 *
 * Flow: HTTP POST → RequestsController → RequestsService (transaction) → DB + Redis
 */
@Controller('requests')
export class RequestsController {
  constructor(private readonly requestsService: RequestsService) {}

  /**
   * POST /api/v1/requests
   * Creates purchase requests from a distributor to one or more farmers.
   * Uses pessimistic row-level locking to safely handle concurrent buyers.
   * On success, publishes a real-time notification via Redis Pub/Sub.
   *
   * Body: { distributorId, farmerIds: number[], items: [{ productId, quantity }] }
   */
  @Post()
  createRequests(@Body() dto: CreateRequestDto) {
    return this.requestsService.createRequests(dto);
  }
}
