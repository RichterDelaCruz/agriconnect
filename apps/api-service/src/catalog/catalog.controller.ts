import { Controller, Get, Param, Query, ParseIntPipe } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { PaginationQueryDto } from '@agriconnect/common';

@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get('farmers')
  getFarmers(@Query() query: PaginationQueryDto) {
    return this.catalogService.getFarmers(query);
  }

  @Get('farmers/:farmerId/products')
  getProductsByFarmer(
    @Param('farmerId', ParseIntPipe) farmerId: number,
    @Query() query: PaginationQueryDto & { inStockOnly?: boolean },
  ) {
    return this.catalogService.getProductsByFarmer(farmerId, query);
  }
}
