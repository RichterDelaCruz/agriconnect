import { Controller, Get, Param, Query, ParseIntPipe } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { PaginationQueryDto } from '@agriconnect/common';

/**
 * Catalog Controller — Public-facing REST endpoints for browsing farmers
 * and their products.
 *
 * All routes are prefixed with `/api/v1/catalog` (set in main.ts).
 * Responses use cursor-based pagination via `PaginationQueryDto`.
 *
 * Flow: HTTP Request → Controller → CatalogService → Database → JSON Response
 */
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  /**
   * GET /api/v1/catalog/farmers
   * Returns a cursor-paginated list of all farmers.
   * Query params: ?limit=20&cursor=5
   */
  @Get('farmers')
  getFarmers(@Query() query: PaginationQueryDto) {
    return this.catalogService.getFarmers(query);
  }

  /**
   * GET /api/v1/catalog/farmers/:farmerId/products
   * Returns a cursor-paginated list of products for a specific farmer.
   * Query params: ?limit=10&cursor=3&inStockOnly=true
   */
  @Get('farmers/:farmerId/products')
  getProductsByFarmer(
    @Param('farmerId', ParseIntPipe) farmerId: number,
    @Query() query: PaginationQueryDto & { inStockOnly?: boolean },
  ) {
    return this.catalogService.getProductsByFarmer(farmerId, query);
  }
}
