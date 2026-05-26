import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Product, Request as FarmerRequest, RequestItem } from '@agriconnect/database';
import { RequestsService, FARMER_NOTIFICATIONS_CHANNEL } from './requests.service';
import { REDIS_PUBLISHER } from '../redis/redis.module';
import { RequestStatus } from '@agriconnect/database';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Factory: creates a minimal Product entity with sensible defaults.
 * Use `overrides` to customize specific fields for each test case.
 * This avoids repeating the full object shape in every test.
 */
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

// Repository mocks are minimal because the service primarily uses
// DataSource.transaction() (via the manager), not the repositories directly.
const mockRequestRepository = () => ({ save: jest.fn(), create: jest.fn() });
const mockRequestItemRepository = () => ({});

// Redis publisher: default resolves successfully, tests can override for error scenarios
const mockRedisPublisher = () => ({ publish: jest.fn().mockResolvedValue(1) });

/**
 * Builds a mock transaction manager that simulates TypeORM's query builder
 * inside a transaction callback.
 *
 * The mock QueryBuilder supports:
 *   - setLock('pessimistic_write') → FOR UPDATE
 *   - whereInIds(productIds)
 *   - getMany() → returns the products we pass in
 *
 * The manager also has mock save() and create() methods that the
 * transaction callback calls to persist Request and RequestItem records.
 *
 * @param products - The fake data that getMany() should return after "locking"
 */
function buildManagerMock(products: Product[]) {
  // Chainable query builder (same pattern as catalog tests)
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
    // save: merges the saved object with an id (simulates DB assigning an ID)
    save: jest.fn().mockImplementation((_entity: unknown, obj: unknown) =>
      Promise.resolve({ ...(obj as object), id: 'req-1' }),
    ),
    // create: just returns the plain object (no DB interaction)
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
    // ── Test: Invalid productId → NotFoundException → transaction rolls back ──
    it('rolls back when a product is not found (NotFoundException)', async () => {
      // We mock dataSource.transaction to execute the callback with a manager
      // that returns 0 "locked" products. The service expects 1 (productId: 999).
      // When lockedProducts.length !== productIds.length, it throws NotFound.
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

      // Note: We verify the exception was thrown, which means the
      // transaction callback threw → TypeORM would roll back automatically.
    });

    // ── Test: Insufficient stock → BadRequestException → transaction rolls back ──
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
          items: [{ productId: 1, quantity: 99 }], // request 99, only 1 available
        }),
      ).rejects.toThrow(BadRequestException);

      // The BadRequestException is thrown INSIDE the transaction callback,
      // so TypeORM would roll back the entire transaction automatically.
    });
  });

  describe('createRequests — happy path', () => {
    // ── Test: Full success flow (transaction commit + Redis publish) ───────
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
        // Override save: when saving a Request (has farmerId), return
        // the shaped savedRequest; for other saves (Product), return obj.
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

      // ── Assertions ──
      // 1. Transaction completed and returned the saved request
      expect(result).toEqual([savedRequest]);

      // 2. Redis publish was called with the correct channel and payload
      expect(redisPublisher.publish).toHaveBeenCalledWith(
        FARMER_NOTIFICATIONS_CHANNEL,
        expect.stringContaining('"farmerId":"1"'),
      );
    });

    // ── Test: Redis failure doesn't break the response ─────────────────────
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

      // Simulate Redis being down → publish throws
      redisPublisher.publish.mockRejectedValue(new Error('Redis down'));

      // This should NOT throw — the catch in publishNotifications() swallows
      // Redis errors to preserve the committed transaction.
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
