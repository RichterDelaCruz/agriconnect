import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Farmer, Product } from '@agriconnect/database';
import { CatalogService } from './catalog.service';

// ── Mock factories ─────────────────────────────────────────────────────────────
// We mock the TypeORM repositories because we're unit-testing the service
// logic in isolation — no real database involved.
// Each mock returns a jest.fn() for createQueryBuilder, which is the
// entry point for all query building in the service.
const mockFarmerRepository = () => ({
  createQueryBuilder: jest.fn(),
});

const mockProductRepository = () => ({
  createQueryBuilder: jest.fn(),
});

/**
 * Builds a mock QueryBuilder that returns the given `rows` from getMany().
 *
 * TypeORM's QueryBuilder is chainable — each method (orderBy, where, take, etc.)
 * returns `this`. Our mock replicates this by making every method return the
 * same qb object, except getMany() which returns the actual rows.
 *
 * @param rows - The fake data that getMany() should resolve with
 */
function buildQbMock(rows: unknown[]) {
  const qb: Record<string, jest.Mock> = {
    orderBy: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    take: jest.fn(),
    getMany: jest.fn().mockResolvedValue(rows),
  };
  // Make all methods chainable (return `this` = the qb object)
  Object.keys(qb).forEach((k) => {
    if (k !== 'getMany') qb[k].mockReturnValue(qb);
  });
  return qb;
}

describe('CatalogService', () => {
  let service: CatalogService;
  let farmerRepo: ReturnType<typeof mockFarmerRepository>;
  let productRepo: ReturnType<typeof mockProductRepository>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CatalogService,
        { provide: getRepositoryToken(Farmer), useFactory: mockFarmerRepository },
        { provide: getRepositoryToken(Product), useFactory: mockProductRepository },
      ],
    }).compile();

    service = module.get(CatalogService);
    farmerRepo = module.get(getRepositoryToken(Farmer));
    productRepo = module.get(getRepositoryToken(Product));
  });

  describe('getFarmers', () => {
    // ── Test: Normal pagination (less than limit) ──────────────────────────
    it('returns paginated farmers with hasNextPage=false when results <= limit', async () => {
      // Simulate 5 farmers returned from DB (limit is 20, so no next page)
      const farmers = Array.from({ length: 5 }, (_, i) => ({
        id: i,
        name: `Farmer ${i}`,
        imageUrl: null,
      }));
      farmerRepo.createQueryBuilder.mockReturnValue(buildQbMock(farmers));

      const result = await service.getFarmers({ limit: 20 });

      // 5 <= 20 → no extra row → hasNextPage=false
      expect(result.hasNextPage).toBe(false);
      expect(result.nextCursor).toBeNull();
      expect(result.data).toHaveLength(5);
    });

    // ── Test: Detecting next page via extra row ────────────────────────────
    it('returns hasNextPage=true and nextCursor when extra row is present', async () => {
      // Return limit+1 rows (21) to signal there is a next page.
      // The service fetches limit+1 and uses the extra row as a page-boundary marker.
      const farmers = Array.from({ length: 21 }, (_, i) => ({
        id: i,
        name: `Farmer ${i}`,
        imageUrl: null,
      }));
      farmerRepo.createQueryBuilder.mockReturnValue(buildQbMock(farmers));

      const result = await service.getFarmers({ limit: 20 });

      // 21 > 20 → hasNextPage=true
      expect(result.hasNextPage).toBe(true);
      // nextCursor is the ID of the last kept item (index 19 = id 19)
      expect(result.nextCursor).toBe(19);
      // Only 20 items returned (the 21st is the "peek" row)
      expect(result.data).toHaveLength(20);
    });

    // ── Test: Empty dataset ────────────────────────────────────────────────
    it('returns empty array with hasNextPage=false for empty dataset', async () => {
      farmerRepo.createQueryBuilder.mockReturnValue(buildQbMock([]));

      const result = await service.getFarmers({ limit: 20 });

      expect(result.data).toHaveLength(0);
      expect(result.hasNextPage).toBe(false);
      expect(result.nextCursor).toBeNull();
    });

    // ── Test: Hard limit cap ───────────────────────────────────────────────
    it('caps limit at MAX_LIMIT (100)', async () => {
      const qb = buildQbMock([]);
      farmerRepo.createQueryBuilder.mockReturnValue(qb);

      // Client asks for 9999, but service should cap at 100
      await service.getFarmers({ limit: 9999 });

      // take() is called with MIN(9999, 100) + 1 = 101
      expect(qb.take).toHaveBeenCalledWith(101);
    });

    // ── Test: CDN prefix applied to non-null imageUrl ──────────────────────
    it('prefixes imageUrl with CDN base', async () => {
      const farmers = [{ id: 'id-1', name: 'Farmer 1', imageUrl: 'farmers/f1.jpg' }];
      farmerRepo.createQueryBuilder.mockReturnValue(buildQbMock(farmers));

      const result = await service.getFarmers({ limit: 20 });

      expect(result.data[0].imageUrl).toContain('cdn.agriconnect.com');
    });

    // ── Test: Null imageUrl stays null (no broken CDN links) ───────────────
    it('leaves null imageUrl as null (no CDN prefix)', async () => {
      const farmers = [{ id: 1, name: 'Farmer 1', imageUrl: null }];
      farmerRepo.createQueryBuilder.mockReturnValue(buildQbMock(farmers));

      const result = await service.getFarmers({ limit: 20 });

      expect(result.data[0].imageUrl).toBeNull();
    });

    // ── Test: Cursor filter applied ────────────────────────────────────────
    it('applies cursor filter when cursor is provided', async () => {
      const qb = buildQbMock([]);
      farmerRepo.createQueryBuilder.mockReturnValue(qb);

      // cursor=42 → should generate WHERE id > 42
      await service.getFarmers({ limit: 20, cursor: 42 });

      expect(qb.where).toHaveBeenCalledWith('farmer.id > :cursor', { cursor: 42 });
    });
  });

  describe('getProductsByFarmer', () => {
    // ── Test: Products returned for a valid farmer ─────────────────────────
    it('returns products for a specific farmer', async () => {
      const products = Array.from({ length: 3 }, (_, i) => ({
        id: i,
        farmerId: 1,
        name: `Product ${i}`,
        imageUrl: null,
      }));
      productRepo.createQueryBuilder.mockReturnValue(buildQbMock(products));

      const result = await service.getProductsByFarmer(1, { limit: 20 });

      expect(result.data).toHaveLength(3);
    });

    // ── Test: Cursor applied to products query ────────────────────────────
    it('applies cursor correctly when provided', async () => {
      const qb = buildQbMock([]);
      productRepo.createQueryBuilder.mockReturnValue(qb);

      await service.getProductsByFarmer(1, { limit: 20, cursor: 5 });

      // andWhere is used (not where) because there's already a farmerId filter
      expect(qb.andWhere).toHaveBeenCalledWith(
        'product.id > :cursor',
        { cursor: 5 },
      );
    });

    // ── Test: Stock filter applied ─────────────────────────────────────────
    it('applies stock filter when inStockOnly=true', async () => {
      const qb = buildQbMock([]);
      productRepo.createQueryBuilder.mockReturnValue(qb);

      await service.getProductsByFarmer(1, { limit: 20, inStockOnly: true });

      // Verifies the AND stockQuantity > 0 condition is added
      expect(qb.andWhere).toHaveBeenCalledWith('product.stockQuantity > 0');
    });

    // ── Test: Next page detection for products ─────────────────────────────
    it('returns hasNextPage=true and nextCursor when extra row present', async () => {
      const products = Array.from({ length: 6 }, (_, i) => ({
        id: i + 1, farmerId: 1, name: `P${i}`, imageUrl: null,
      }));
      productRepo.createQueryBuilder.mockReturnValue(buildQbMock(products));

      const result = await service.getProductsByFarmer(1, { limit: 5 });

      // 6 > 5 → hasNextPage=true
      expect(result.hasNextPage).toBe(true);
      // nextCursor is the ID of the last kept item (id 5)
      expect(result.nextCursor).toBe(5);
      // Only 5 items returned (the 6th is the "peek" row)
      expect(result.data).toHaveLength(5);
    });

    // ── Test: CDN prefix on product images ─────────────────────────────────
    it('prefixes non-null product imageUrl with CDN base', async () => {
      const products = [{ id: 1, farmerId: 1, name: 'Rice', imageUrl: 'products/rice.jpg' }];
      productRepo.createQueryBuilder.mockReturnValue(buildQbMock(products));

      const result = await service.getProductsByFarmer(1, { limit: 20 });

      expect(result.data[0].imageUrl).toMatch(/^https:\/\/cdn\.agriconnect\.com\/media\//)
    });

    // ── Test: Null product imageUrl stays null ─────────────────────────────
    it('leaves null product imageUrl as null (no CDN prefix)', async () => {
      const products = [{ id: 1, farmerId: 1, name: 'Rice', imageUrl: null }];
      productRepo.createQueryBuilder.mockReturnValue(buildQbMock(products));

      const result = await service.getProductsByFarmer(1, { limit: 20 });

      expect(result.data[0].imageUrl).toBeNull();
    });

    // ── Test: Empty results for unknown farmer ─────────────────────────────
    it('returns empty result for a farmer with no products', async () => {
      productRepo.createQueryBuilder.mockReturnValue(buildQbMock([]));

      const result = await service.getProductsByFarmer(999, { limit: 20 });

      expect(result.data).toHaveLength(0);
      expect(result.hasNextPage).toBe(false);
      expect(result.nextCursor).toBeNull();
    });
  });
});
