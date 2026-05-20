import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Farmer, Product } from '@agriconnect/database';
import { CatalogService } from './catalog.service';

const mockFarmerRepository = () => ({
  createQueryBuilder: jest.fn(),
});

const mockProductRepository = () => ({
  createQueryBuilder: jest.fn(),
});

function buildQbMock(rows: unknown[]) {
  const qb: Record<string, jest.Mock> = {
    orderBy: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    take: jest.fn(),
    getMany: jest.fn().mockResolvedValue(rows),
  };
  // make chainable
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
    it('returns paginated farmers with hasNextPage=false when results <= limit', async () => {
      const farmers = Array.from({ length: 5 }, (_, i) => ({
        id: i,
        name: `Farmer ${i}`,
        imageUrl: null,
      }));
      farmerRepo.createQueryBuilder.mockReturnValue(buildQbMock(farmers));

      const result = await service.getFarmers({ limit: 20 });

      expect(result.hasNextPage).toBe(false);
      expect(result.nextCursor).toBeNull();
      expect(result.data).toHaveLength(5);
    });

    it('returns hasNextPage=true and nextCursor when extra row is present', async () => {
      // Return limit+1 rows (21) to signal there is a next page
      const farmers = Array.from({ length: 21 }, (_, i) => ({
        id: i,
        name: `Farmer ${i}`,
        imageUrl: null,
      }));
      farmerRepo.createQueryBuilder.mockReturnValue(buildQbMock(farmers));

      const result = await service.getFarmers({ limit: 20 });

      expect(result.hasNextPage).toBe(true);
      expect(result.nextCursor).toBe(19);
      expect(result.data).toHaveLength(20);
    });

    it('returns empty array with hasNextPage=false for empty dataset', async () => {
      farmerRepo.createQueryBuilder.mockReturnValue(buildQbMock([]));

      const result = await service.getFarmers({ limit: 20 });

      expect(result.data).toHaveLength(0);
      expect(result.hasNextPage).toBe(false);
      expect(result.nextCursor).toBeNull();
    });

    it('caps limit at MAX_LIMIT (100)', async () => {
      const qb = buildQbMock([]);
      farmerRepo.createQueryBuilder.mockReturnValue(qb);

      await service.getFarmers({ limit: 9999 });

      // take() is called with MAX_LIMIT + 1 = 101
      expect(qb.take).toHaveBeenCalledWith(101);
    });

    it('prefixes imageUrl with CDN base', async () => {
      const farmers = [{ id: 'id-1', name: 'Farmer 1', imageUrl: 'farmers/f1.jpg' }];
      farmerRepo.createQueryBuilder.mockReturnValue(buildQbMock(farmers));

      const result = await service.getFarmers({ limit: 20 });

      expect(result.data[0].imageUrl).toContain('cdn.agriconnect.com');
    });

    it('leaves null imageUrl as null (no CDN prefix)', async () => {
      const farmers = [{ id: 1, name: 'Farmer 1', imageUrl: null }];
      farmerRepo.createQueryBuilder.mockReturnValue(buildQbMock(farmers));

      const result = await service.getFarmers({ limit: 20 });

      expect(result.data[0].imageUrl).toBeNull();
    });

    it('applies cursor filter when cursor is provided', async () => {
      const qb = buildQbMock([]);
      farmerRepo.createQueryBuilder.mockReturnValue(qb);

      await service.getFarmers({ limit: 20, cursor: 42 });

      expect(qb.where).toHaveBeenCalledWith('farmer.id > :cursor', { cursor: 42 });
    });
  });

  describe('getProductsByFarmer', () => {
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

    it('applies cursor correctly when provided', async () => {
      const qb = buildQbMock([]);
      productRepo.createQueryBuilder.mockReturnValue(qb);

      await service.getProductsByFarmer(1, { limit: 20, cursor: 5 });

      expect(qb.andWhere).toHaveBeenCalledWith(
        'product.id > :cursor',
        { cursor: 5 },
      );
    });

    it('applies stock filter when inStockOnly=true', async () => {
      const qb = buildQbMock([]);
      productRepo.createQueryBuilder.mockReturnValue(qb);

      await service.getProductsByFarmer(1, { limit: 20, inStockOnly: true });

      expect(qb.andWhere).toHaveBeenCalledWith('product.stockQuantity > 0');
    });

    it('returns hasNextPage=true and nextCursor when extra row present', async () => {
      const products = Array.from({ length: 6 }, (_, i) => ({
        id: i + 1, farmerId: 1, name: `P${i}`, imageUrl: null,
      }));
      productRepo.createQueryBuilder.mockReturnValue(buildQbMock(products));

      const result = await service.getProductsByFarmer(1, { limit: 5 });

      expect(result.hasNextPage).toBe(true);
      expect(result.nextCursor).toBe(5); // id of the 5th (last kept) item
      expect(result.data).toHaveLength(5);
    });

    it('prefixes non-null product imageUrl with CDN base', async () => {
      const products = [{ id: 1, farmerId: 1, name: 'Rice', imageUrl: 'products/rice.jpg' }];
      productRepo.createQueryBuilder.mockReturnValue(buildQbMock(products));

      const result = await service.getProductsByFarmer(1, { limit: 20 });

      expect(result.data[0].imageUrl).toMatch(/^https:\/\/cdn\.agriconnect\.com\/media\//)
    });

    it('leaves null product imageUrl as null (no CDN prefix)', async () => {
      const products = [{ id: 1, farmerId: 1, name: 'Rice', imageUrl: null }];
      productRepo.createQueryBuilder.mockReturnValue(buildQbMock(products));

      const result = await service.getProductsByFarmer(1, { limit: 20 });

      expect(result.data[0].imageUrl).toBeNull();
    });

    it('returns empty result for a farmer with no products', async () => {
      productRepo.createQueryBuilder.mockReturnValue(buildQbMock([]));

      const result = await service.getProductsByFarmer(999, { limit: 20 });

      expect(result.data).toHaveLength(0);
      expect(result.hasNextPage).toBe(false);
      expect(result.nextCursor).toBeNull();
    });
  });
});
