/**
 * E2E Test Suite — AgriConnect API
 *
 * Covers four system-level behaviours against a live PostgreSQL + Redis:
 *
 *  1. Catalog pagination  — GET /farmers and GET /farmers/:id/products
 *  2. Concurrency safety  — 50 simultaneous POST /requests with 1 unit of stock
 *  3. Redis Pub/Sub       — message delivered within 200 ms SLA
 *  4. WebSocket delivery  — Socket.IO client connected to notification-service
 *                           receives the "new_request" event end-to-end
 *
 * Prerequisites: PostgreSQL and Redis running (docker compose up -d).
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { AppModule as NotificationAppModule } from '../../notification-service/src/app.module';
import { AppDataSource } from '@agriconnect/database';
import { Redis } from 'ioredis';

// ─── DB helpers ──────────────────────────────────────────────────────────────

async function getRepos() {
  if (!AppDataSource.isInitialized) await AppDataSource.initialize();
  return {
    farmerRepo:      AppDataSource.getRepository('farmer'),
    productRepo:     AppDataSource.getRepository('product'),
    distributorRepo: AppDataSource.getRepository('distributor'),
  };
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('AgriConnect API (e2e)', () => {
  let app: INestApplication;
  let notificationApp: INestApplication;

  beforeAll(async () => {
    // Start the API service
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();

    // Start the notification service on port 3001 so Socket.IO clients can connect
    const notificationFixture: TestingModule = await Test.createTestingModule({
      imports: [NotificationAppModule],
    }).compile();

    notificationApp = notificationFixture.createNestApplication();
    await notificationApp.listen(3001);

    await getRepos();
  });

  afterAll(async () => {
    await notificationApp.close();
    await app.close();
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  });

  // ── 1. Catalog ─────────────────────────────────────────────────────────────

  describe('GET /api/v1/catalog/farmers', () => {
    it('returns the first page of farmers with pagination metadata', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/catalog/farmers?limit=5')
        .expect(200);

      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0]).toMatchObject({
        id:       expect.any(Number),
        name:     expect.any(String),
        location: expect.any(String),
      });
      expect(typeof res.body.hasNextPage).toBe('boolean');
    });

    it('advances the cursor correctly', async () => {
      const page1 = await request(app.getHttpServer())
        .get('/api/v1/catalog/farmers?limit=3')
        .expect(200);

      expect(page1.body.hasNextPage).toBe(true);
      const cursor = page1.body.nextCursor;

      const page2 = await request(app.getHttpServer())
        .get(`/api/v1/catalog/farmers?limit=3&cursor=${cursor}`)
        .expect(200);

      const lastIdPage1  = page1.body.data[page1.body.data.length - 1].id;
      const firstIdPage2 = page2.body.data[0].id;
      expect(firstIdPage2).toBeGreaterThan(lastIdPage1);
    });

    it('returns 400 for a non-numeric farmerId param', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/catalog/farmers/not-a-number/products')
        .expect(400);
    });

    it('returns the last page with hasNextPage=false and nextCursor=null', async () => {
      const { farmerRepo } = await getRepos();

      // Create 3 farmers and request exactly 3 — no overflow row exists
      const farmers = await farmerRepo.save([
        { name: 'Last Page A', location: 'LP Region', imageUrl: null },
        { name: 'Last Page B', location: 'LP Region', imageUrl: null },
        { name: 'Last Page C', location: 'LP Region', imageUrl: null },
      ]) as unknown as Array<{ id: number }>;

      // Use a cursor just before the first newly created farmer so only these 3 are returned
      const cursorBefore = farmers[0].id - 1;

      const res = await request(app.getHttpServer())
        .get(`/api/v1/catalog/farmers?limit=3&cursor=${cursorBefore}`)
        .expect(200);

      // We may get more than 3 if there are DB farmers with IDs in range, so just
      // confirm that a page with fewer rows than limit signals no next page.
      if (res.body.data.length <= 3) {
        expect(res.body.hasNextPage).toBe(false);
        expect(res.body.nextCursor).toBeNull();
      }
    });
  });

  describe('GET /api/v1/catalog/farmers/:id/products', () => {
    it('returns products for a known farmer with CDN image URLs', async () => {
      const { farmerRepo, productRepo } = await getRepos();

      const farmer = await farmerRepo.save({
        name: 'E2E Farmer', location: 'Test Region', imageUrl: null,
      });
      await productRepo.save([
        { farmerId: farmer.id, name: 'P1', price: 10, stockQuantity: 5, imageUrl: 'products/p1.jpg' },
        { farmerId: farmer.id, name: 'P2', price: 20, stockQuantity: 0, imageUrl: null },
      ]);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/catalog/farmers/${farmer.id}/products?limit=10`)
        .expect(200);

      expect(res.body.data).toHaveLength(2);

      const withImage = res.body.data.find((p: { imageUrl: string }) => p.imageUrl);
      expect(withImage.imageUrl).toMatch(/^https:\/\/cdn\.agriconnect\.com\/media\//);
    });

    it('filters to in-stock products only when inStockOnly=true', async () => {
      const { farmerRepo, productRepo } = await getRepos();

      const farmer = await farmerRepo.save({
        name: 'InStock Farmer', location: 'Region X', imageUrl: null,
      });
      await productRepo.save([
        { farmerId: farmer.id, name: 'In Stock',  price: 10, stockQuantity: 5, imageUrl: null },
        { farmerId: farmer.id, name: 'Out Stock', price: 10, stockQuantity: 0, imageUrl: null },
      ]);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/catalog/farmers/${farmer.id}/products?inStockOnly=true`)
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('In Stock');
    });

    it('returns an empty data array for a farmer that exists but has no products', async () => {
      const { farmerRepo } = await getRepos();

      const farmer = await farmerRepo.save({
        name: 'Empty Farmer', location: 'Empty Region', imageUrl: null,
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/catalog/farmers/${farmer.id}/products`)
        .expect(200);

      expect(res.body.data).toHaveLength(0);
      expect(res.body.hasNextPage).toBe(false);
      expect(res.body.nextCursor).toBeNull();
    });
  });

  // ── 2. Concurrency ─────────────────────────────────────────────────────────

  describe('POST /api/v1/requests — concurrent request routing', () => {
    it('returns 404 when requesting a product that does not exist', async () => {
      const { distributorRepo } = await getRepos();
      const distributor = await distributorRepo.save({
        name: 'Ghost Buyer', email: `ghost-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .post('/api/v1/requests')
        .send({
          distributorId: distributor.id,
          farmerIds:     [1],
          items:         [{ productId: 999999999, quantity: 1 }],
        })
        .expect(404);
    });

    it('returns 400 when product stock is already zero', async () => {
      const { farmerRepo, productRepo, distributorRepo } = await getRepos();

      const farmer = await farmerRepo.save({
        name: 'Zero Stock Farmer', location: 'Dry Region', imageUrl: null,
      });
      const product = await productRepo.save({
        farmerId: farmer.id, name: 'Sold Out', price: 50,
        stockQuantity: 0, imageUrl: null,
      });
      const distributor = await distributorRepo.save({
        name: 'Hopeful Buyer', email: `hopeful-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .post('/api/v1/requests')
        .send({
          distributorId: distributor.id,
          farmerIds:     [farmer.id],
          items:         [{ productId: product.id, quantity: 1 }],
        })
        .expect(400);
    });

    it('returns 400 when requested quantity exceeds stock', async () => {
      const { farmerRepo, productRepo, distributorRepo } = await getRepos();

      const farmer = await farmerRepo.save({
        name: 'Low Stock Farmer', location: 'Low Region', imageUrl: null,
      });
      const product = await productRepo.save({
        farmerId: farmer.id, name: 'Low Stock', price: 50,
        stockQuantity: 2, imageUrl: null,
      });
      const distributor = await distributorRepo.save({
        name: 'Greedy Buyer', email: `greedy-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .post('/api/v1/requests')
        .send({
          distributorId: distributor.id,
          farmerIds:     [farmer.id],
          items:         [{ productId: product.id, quantity: 100 }],
        })
        .expect(400);
    });

    it(
      'allows exactly 1 of 50 concurrent requests to succeed when only 1 unit is in stock',
      async () => {
        const { farmerRepo, productRepo, distributorRepo } = await getRepos();

        const farmer = await farmerRepo.save({
          name: 'Race Farmer', location: 'Race Region', imageUrl: null,
        });
        const product = await productRepo.save({
          farmerId: farmer.id, name: 'Last Unit', price: 100,
          stockQuantity: 1, imageUrl: null,
        });
        const distributors = await distributorRepo.save(
          Array.from({ length: 50 }, (_, i) => ({
            name: `Dist ${i}`, email: `race-${i}-${Date.now()}@test.com`,
          })),
        );

        const statuses = await Promise.all(
          (distributors as unknown as Array<{ id: string }>).map((d) =>
            request(app.getHttpServer())
              .post('/api/v1/requests')
              .send({
                distributorId: d.id,
                farmerIds:     [farmer.id],
                items:         [{ productId: product.id, quantity: 1 }],
              })
              .then((res: { status: number }) => res.status),
          ),
        );

        expect(statuses.filter((s: number) => s === 201)).toHaveLength(1);
        expect(statuses.filter((s: number) => s === 400)).toHaveLength(49);
      },
      30_000,
    );
  });

  // ── 3. Real-time notification ──────────────────────────────────────────────

  describe('Redis Pub/Sub notification delivery', () => {
    it(
      'publishes a farmer_notifications message within 200 ms of request commit',
      async () => {
        const { farmerRepo, productRepo, distributorRepo } = await getRepos();

        const farmer = await farmerRepo.save({
          name: 'WS Farmer', location: 'WS Region', imageUrl: null,
        });
        const product = await productRepo.save({
          farmerId: farmer.id, name: 'WS Product', price: 50,
          stockQuantity: 10, imageUrl: null,
        });
        const distributor = await distributorRepo.save({
          name: 'WS Distributor', email: `ws-${Date.now()}@test.com`,
        });

        const subscriber = new Redis({
          host: process.env.REDIS_HOST ?? 'localhost',
          port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
        });

        const notificationReceived = new Promise<Record<string, unknown>>(
          (resolve, reject) => {
            const timeout = setTimeout(
              () => reject(new Error('No Redis message within 200 ms')),
              200,
            );
            subscriber.subscribe('farmer_notifications', (err) => {
              if (err) { clearTimeout(timeout); reject(err); }
            });
            subscriber.on('message', (_ch, msg) => {
              clearTimeout(timeout);
              resolve(JSON.parse(msg) as Record<string, unknown>);
            });
          },
        );

        await request(app.getHttpServer())
          .post('/api/v1/requests')
          .send({
            distributorId: distributor.id,
            farmerIds:     [farmer.id],
            items:         [{ productId: product.id, quantity: 1 }],
          })
          .expect(201);

        const payload = await notificationReceived;

        expect(payload.farmerId).toBe(String(farmer.id));
        expect(payload.requestId).toBeDefined();
        expect(payload.message).toBeDefined();

        await subscriber.quit();
      },
      10_000,
    );
  });

  // ── 4. WebSocket end-to-end delivery ──────────────────────────────────────

  describe('WebSocket — Socket.IO client receives "new_request" event', () => {
    it(
      'delivers the notification to a registered farmer socket within 1 s',
      async () => {
        const { farmerRepo, productRepo, distributorRepo } = await getRepos();

        const farmer = await farmerRepo.save({
          name: 'Socket Farmer', location: 'Socket Region', imageUrl: null,
        });
        const product = await productRepo.save({
          farmerId: farmer.id, name: 'Socket Product', price: 30,
          stockQuantity: 5, imageUrl: null,
        });
        const distributor = await distributorRepo.save({
          name: 'Socket Distributor', email: `sock-${Date.now()}@test.com`,
        });

        // Connect a Socket.IO client to the notification-service namespace
        const socket: ClientSocket = ioClient(
          'http://localhost:3001/notifications',
          { transports: ['websocket'] },
        );

        const eventReceived = new Promise<Record<string, unknown>>(
          (resolve, reject) => {
            const timeout = setTimeout(
              () => reject(new Error('No WebSocket event within 1 s')),
              1000,
            );
            socket.on('connect', () => {
              // Register this socket as the farmer so the gateway routes to it
              socket.emit('register', { farmerId: String(farmer.id) });
            });
            socket.on('new_request', (payload: Record<string, unknown>) => {
              clearTimeout(timeout);
              resolve(payload);
            });
            socket.on('connect_error', (err: Error) => {
              clearTimeout(timeout);
              reject(err);
            });
          },
        );

        // Give the socket a moment to connect and register before placing the order
        await new Promise((r) => setTimeout(r, 100));

        await request(app.getHttpServer())
          .post('/api/v1/requests')
          .send({
            distributorId: distributor.id,
            farmerIds:     [farmer.id],
            items:         [{ productId: product.id, quantity: 1 }],
          })
          .expect(201);

        const payload = await eventReceived;

        expect(payload.farmerId).toBe(String(farmer.id));
        expect(payload.requestId).toBeDefined();
        expect(payload.message).toBeDefined();

        socket.disconnect();
      },
      15_000,
    );
  });
});
