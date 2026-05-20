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
        id: `id-${i}`,
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
        id: `id-${i}`,
        name: `Farmer ${i}`,
        imageUrl: null,
      }));
      farmerRepo.createQueryBuilder.mockReturnValue(buildQbMock(farmers));

      const result = await service.getFarmers({ limit: 20 });

      expect(result.hasNextPage).toBe(true);
      expect(result.nextCursor).toBe('id-19');
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
  });

  describe('getProductsByFarmer', () => {
    it('returns products for a specific farmer', async () => {
      const products = Array.from({ length: 3 }, (_, i) => ({
        id: `pid-${i}`,
        farmerId: 'f-1',
        name: `Product ${i}`,
        imageUrl: null,
      }));
      productRepo.createQueryBuilder.mockReturnValue(buildQbMock(products));

      const result = await service.getProductsByFarmer('f-1', { limit: 20 });

      expect(result.data).toHaveLength(3);
    });

    it('applies cursor correctly when provided', async () => {
      const qb = buildQbMock([]);
      productRepo.createQueryBuilder.mockReturnValue(qb);

      await service.getProductsByFarmer('f-1', { limit: 20, cursor: 'cursor-id' });

      expect(qb.andWhere).toHaveBeenCalledWith(
        'product.id > :cursor',
        { cursor: 'cursor-id' },
      );
    });

    it('applies stock filter when inStockOnly=true', async () => {
      const qb = buildQbMock([]);
      productRepo.createQueryBuilder.mockReturnValue(qb);

      await service.getProductsByFarmer('f-1', { limit: 20, inStockOnly: true });

      expect(qb.andWhere).toHaveBeenCalledWith('product.stockQuantity > 0');
    });
  });
});
