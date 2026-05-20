import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Farmer, Product } from '@agriconnect/database';
import { PaginatedResponseDto, PaginationQueryDto } from '@agriconnect/common';

const CDN_BASE = process.env.CDN_BASE_URL ?? 'https://cdn.agriconnect.com/media';
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

@Injectable()
export class CatalogService {
  constructor(
    @InjectRepository(Farmer)
    private readonly farmerRepository: Repository<Farmer>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
  ) {}

  /**
   * Retrieves a cursor-paginated list of farmers.
   *
   * Uses cursor-based pagination (keyset pagination) on the farmer `id` (UUID v4).
   * This avoids the O(offset) cost of OFFSET-based pagination, keeping query
   * time O(log n) via the primary key index regardless of dataset size.
   *
   * The `imageUrl` is remapped to the CDN domain before being returned so the
   * application never serves raw files directly.
   */
  async getFarmers(
    query: PaginationQueryDto,
  ): Promise<PaginatedResponseDto<Farmer>> {
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    const qb = this.farmerRepository
      .createQueryBuilder('farmer')
      .orderBy('farmer.id', 'ASC')
      .take(limit + 1); // fetch one extra to determine hasNextPage

    if (query.cursor) {
      qb.where('farmer.id > :cursor', { cursor: query.cursor });
    }

    const rows = await qb.getMany();

    const hasNextPage = rows.length > limit;
    const data = rows.slice(0, limit).map((f) => ({
      ...f,
      imageUrl: f.imageUrl ? `${CDN_BASE}/${f.imageUrl}` : null,
    }));

    const nextCursor =
      hasNextPage ? (data[data.length - 1]?.id ?? null) : null;

    return { data, nextCursor, hasNextPage };
  }

  /**
   * Retrieves a cursor-paginated list of products for a given farmer.
   *
   * Partial index `idx_active_products` (WHERE stockQuantity > 0) is leveraged
   * when `inStockOnly=true` to drastically reduce the rows scanned.
   */
  async getProductsByFarmer(
    farmerId: number,
    query: PaginationQueryDto & { inStockOnly?: boolean },
  ): Promise<PaginatedResponseDto<Product>> {
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    const qb = this.productRepository
      .createQueryBuilder('product')
      .where('product.farmerId = :farmerId', { farmerId })
      .orderBy('product.id', 'ASC')
      .take(limit + 1);

    if (query.cursor) {
      qb.andWhere('product.id > :cursor', { cursor: query.cursor });
    }

    if (query.inStockOnly) {
      // leverages idx_active_products partial index
      qb.andWhere('product.stockQuantity > 0');
    }

    const rows = await qb.getMany();

    const hasNextPage = rows.length > limit;
    const data = rows.slice(0, limit).map((p) => ({
      ...p,
      imageUrl: p.imageUrl ? `${CDN_BASE}/${p.imageUrl}` : null,
    }));

    const nextCursor =
      hasNextPage ? (data[data.length - 1]?.id ?? null) : null;

    return { data, nextCursor, hasNextPage };
  }
}
