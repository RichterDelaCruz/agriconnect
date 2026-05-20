import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Product, Request as FarmerRequest, RequestItem } from '@agriconnect/database';
import { RequestsService, FARMER_NOTIFICATIONS_CHANNEL } from './requests.service';
import { REDIS_PUBLISHER } from '../redis/redis.module';
import { RequestStatus } from '@agriconnect/database';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 1,
    farmerId: 1,
    name: 'Rice',
    price: 50,
    stockQuantity: 10,
    imageUrl: null,
    farmer: null as never,
    requestItems: [],
    ...overrides,
  };
}

// ── Mock factories ────────────────────────────────────────────────────────────

const mockRequestRepository = () => ({ save: jest.fn(), create: jest.fn() });
const mockRequestItemRepository = () => ({});
const mockRedisPublisher = () => ({ publish: jest.fn().mockResolvedValue(1) });

function buildManagerMock(products: Product[]) {
  const qb: Record<string, jest.Mock> = {
    setLock: jest.fn(),
    whereInIds: jest.fn(),
    getMany: jest.fn().mockResolvedValue(products),
  };
  Object.keys(qb).forEach((k) => {
    if (k !== 'getMany') qb[k].mockReturnValue(qb);
  });

  return {
    createQueryBuilder: jest.fn().mockReturnValue(qb),
    save: jest.fn().mockImplementation((_entity: unknown, obj: unknown) =>
      Promise.resolve({ ...(obj as object), id: 'req-1' }),
    ),
    create: jest.fn().mockImplementation((_entity: unknown, obj: unknown) => obj),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RequestsService', () => {
  let service: RequestsService;
  let redisPublisher: ReturnType<typeof mockRedisPublisher>;
  let dataSource: { transaction: jest.Mock };

  beforeEach(async () => {
    dataSource = { transaction: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RequestsService,
        { provide: getRepositoryToken(FarmerRequest), useFactory: mockRequestRepository },
        { provide: getRepositoryToken(RequestItem), useFactory: mockRequestItemRepository },
        { provide: getDataSourceToken(), useValue: dataSource },
        { provide: REDIS_PUBLISHER, useFactory: mockRedisPublisher },
      ],
    }).compile();

    service = module.get(RequestsService);
    redisPublisher = module.get(REDIS_PUBLISHER);
  });

  describe('createRequests — transaction rollback on failure', () => {
    it('rolls back when a product is not found (NotFoundException)', async () => {
      // The transaction callback is executed by our mock; we simulate the
      // manager returning fewer products than requested.
      dataSource.transaction.mockImplementation(async (cb: Function) => {
        const manager = buildManagerMock([]); // returns 0 products
        return cb(manager);
      });

      await expect(
        service.createRequests({
          distributorId: 'd-1',
          farmerIds: [1],
          items: [{ productId: 999, quantity: 1 }],
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rolls back when stock is insufficient (BadRequestException)', async () => {
      const lowStockProduct = makeProduct({ stockQuantity: 1 });

      dataSource.transaction.mockImplementation(async (cb: Function) => {
        const manager = buildManagerMock([lowStockProduct]);
        return cb(manager);
      });

      await expect(
        service.createRequests({
          distributorId: 'd-1',
          farmerIds: [1],
          items: [{ productId: 1, quantity: 99 }], // exceeds stock
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('createRequests — happy path', () => {
    it('commits and publishes Redis notification on success', async () => {
      const product = makeProduct({ stockQuantity: 20 });
      const savedRequest = {
        id: 'req-1',
        farmerId: 1,
        distributorId: 'd-1',
        status: RequestStatus.PENDING,
        items: [],
      } as unknown as FarmerRequest;

      dataSource.transaction.mockImplementation(async (cb: Function) => {
        const manager = buildManagerMock([product]);
        // Override save for Request to return a shaped object
        manager.save.mockImplementation(async (_entity: unknown, obj: unknown) => {
          if ((obj as FarmerRequest).farmerId) return savedRequest;
          return obj;
        });
        return cb(manager);
      });

      const result = await service.createRequests({
        distributorId: 'd-1',
        farmerIds: [1],
        items: [{ productId: 1, quantity: 5 }],
      });

      expect(result).toEqual([savedRequest]);
      expect(redisPublisher.publish).toHaveBeenCalledWith(
        FARMER_NOTIFICATIONS_CHANNEL,
        expect.stringContaining('"farmerId":"1"'),
      );
    });

    it('does not throw if Redis publish fails after commit', async () => {
      const product = makeProduct({ stockQuantity: 20 });
      const savedRequest = {
        id: 'req-1',
        farmerId: 1,
        distributorId: 'd-1',
        status: RequestStatus.PENDING,
        items: [],
      } as unknown as FarmerRequest;

      dataSource.transaction.mockImplementation(async (cb: Function) => {
        const manager = buildManagerMock([product]);
        manager.save.mockImplementation(async (_entity: unknown, obj: unknown) => {
          if ((obj as FarmerRequest).farmerId) return savedRequest;
          return obj;
        });
        return cb(manager);
      });

      redisPublisher.publish.mockRejectedValue(new Error('Redis down'));

      // Should resolve without throwing even when Redis is unavailable
      await expect(
        service.createRequests({
          distributorId: 'd-1',
          farmerIds: [1],
          items: [{ productId: 1, quantity: 5 }],
        }),
      ).resolves.toBeDefined();
    });
  });
});
