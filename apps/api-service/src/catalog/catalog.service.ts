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
    // --- Step 1: Clamp limit ---
    // Default to 20 items per page, but never exceed 100 (MAX_LIMIT).
    // This prevents abuse (e.g. someone requesting 1 million rows).
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    // --- Step 2: Build the query ---
    // We use cursor-based (keyset) pagination instead of OFFSET.
    // Why? OFFSET gets slower as you go deeper (it still scans all previous rows).
    // Keyset pagination uses WHERE id > :cursor, which is O(log n) via the PK index.
    //
    // We fetch (limit + 1) rows — the extra row tells us if there's a next page
    // without needing a separate COUNT query.
    const qb = this.farmerRepository
      .createQueryBuilder('farmer')
      .orderBy('farmer.id', 'ASC')
      .take(limit + 1);

    // If the client sent a cursor (the last ID from the previous page),
    // start after that ID. First page has no cursor, so no WHERE clause.
    if (query.cursor) {
      qb.where('farmer.id > :cursor', { cursor: query.cursor });
    }

    // --- Step 3: Execute the query ---
    const rows = await qb.getMany();

    // --- Step 4: Determine if there's a next page ---
    // If we got (limit + 1) rows, the extra row is the first item of the next page.
    // We strip it off and tell the client there's more.
    const hasNextPage = rows.length > limit;

    // --- Step 5: Transform results ---
    // Only take the first `limit` items (discard the extra marker row).
    // For each farmer, prefix the imageUrl with the CDN base URL.
    // If imageUrl is null, leave it null (don't create broken CDN links).
    const data = rows.slice(0, limit).map((f) => ({
      ...f,
      imageUrl: f.imageUrl ? `${CDN_BASE}/${f.imageUrl}` : null,
    }));

    // --- Step 6: Set the next cursor ---
    // If there's a next page, the cursor is the ID of the last item we returned.
    // The client sends this back as ?cursor=N to get the next page.
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
    // Same cursor-pagination logic as getFarmers(), but scoped to one farmer.
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    // --- Step 1: Filter by farmer ---
    // Start with WHERE farmerId = :farmerId to scope products to one farmer.
    const qb = this.productRepository
      .createQueryBuilder('product')
      .where('product.farmerId = :farmerId', { farmerId })
      .orderBy('product.id', 'ASC')
      .take(limit + 1);

    // --- Step 2: Apply optional cursor ---
    if (query.cursor) {
      qb.andWhere('product.id > :cursor', { cursor: query.cursor });
    }

    // --- Step 3: Apply optional stock filter ---
    // If the client only wants in-stock products, add AND stockQuantity > 0.
    // This leverages the partial index `idx_active_products` for efficiency.
    if (query.inStockOnly) {
      qb.andWhere('product.stockQuantity > 0');
    }

    // --- Step 4: Execute and paginate ---
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
