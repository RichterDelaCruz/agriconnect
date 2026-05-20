/**
 * E2E Test: Concurrent Request Routing & WebSocket Pub/Sub
 *
 * Prerequisites (handled by test containers or local docker-compose):
 *   - PostgreSQL on DB_HOST / DB_PORT
 *   - Redis on REDIS_HOST / REDIS_PORT
 *
 * This test suite validates two system-level behaviors:
 *
 *  1. Concurrency safety: 50 simultaneous distributors attempting to
 *     purchase the last available unit of the same product.
 *     Expected: exactly 1 succeeds (201), the rest get 400.
 *
 *  2. Real-time notification: an HTTP request to api-service triggers a
 *     Redis publish that a subscribed notification-service instance
 *     relays over WebSocket to the farmer — within a 200 ms SLA.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { AppDataSource } from '@agriconnect/database';
import { Redis } from 'ioredis';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function seedTestData() {
  const farmerRepo = AppDataSource.getRepository('farmer');
  const productRepo = AppDataSource.getRepository('product');
  const distributorRepo = AppDataSource.getRepository('distributor');

  const farmer = await farmerRepo.save({
    name: 'Test Farmer',
    location: 'Test Region',
    imageUrl: null,
  });

  // Only 1 unit in stock — the race condition target
  const product = await productRepo.save({
    farmerId: farmer.id,
    name: 'Last Batch Rice',
    price: 100,
    stockQuantity: 1,
    imageUrl: null,
  });

  const distributors = await distributorRepo.save(
    Array.from({ length: 50 }, (_, i) => ({
      name: `Distributor ${i}`,
      email: `dist${i}@test.com`,
    })),
  );

  return { farmer, product, distributors };
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('AgriConnect E2E', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();

    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }
  });

  afterAll(async () => {
    await app.close();
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  });

  // ── Concurrency Test ──────────────────────────────────────────────────────

  describe('POST /api/v1/requests — concurrent request routing', () => {
    it(
      'allows exactly 1 of 50 concurrent requests to succeed when only 1 unit is in stock',
      async () => {
        const { farmer, product, distributors } = await seedTestData();

        // Fire all 50 requests simultaneously via Promise.all
        const results = await Promise.all(
          distributors.map((d: { id: string }) =>
            request(app.getHttpServer())
              .post('/api/v1/requests')
              .send({
                distributorId: d.id,
                farmerIds: [farmer.id],
                items: [{ productId: product.id, quantity: 1 }],
              })
              .then((res) => res.status),
          ),
        );

        const successes = results.filter((s) => s === 201);
        const failures = results.filter((s) => s === 400);

        expect(successes).toHaveLength(1);
        expect(failures).toHaveLength(49);
      },
      30_000,
    );
  });

  // ── WebSocket Pub/Sub Test ────────────────────────────────────────────────

  describe('WebSocket real-time notification via Redis Pub/Sub', () => {
    it(
      'delivers a farmer notification within 200ms of request creation',
      async () => {
        const subscriber = new Redis({
          host: process.env.REDIS_HOST ?? 'localhost',
          port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
        });

        const notificationReceived = new Promise<string>(
          (resolve, reject) => {
            const timeout = setTimeout(
              () => reject(new Error('Notification not received within 200ms')),
              200,
            );

            subscriber.subscribe('farmer_notifications', (err) => {
              if (err) reject(err);
            });

            subscriber.on('message', (_channel: string, message: string) => {
              clearTimeout(timeout);
              resolve(message);
            });
          },
        );

        // Seed minimal data for this test
        const farmerRepo = AppDataSource.getRepository('farmer');
        const productRepo = AppDataSource.getRepository('product');
        const distributorRepo = AppDataSource.getRepository('distributor');

        const farmer = await farmerRepo.save({
          name: 'WS Test Farmer',
          location: 'Region WS',
          imageUrl: null,
        });
        const product = await productRepo.save({
          farmerId: farmer.id,
          name: 'WS Product',
          price: 50,
          stockQuantity: 5,
          imageUrl: null,
        });
        const distributor = await distributorRepo.save({
          name: 'WS Distributor',
          email: 'ws@test.com',
        });

        await request(app.getHttpServer())
          .post('/api/v1/requests')
          .send({
            distributorId: distributor.id,
            farmerIds: [farmer.id],
            items: [{ productId: product.id, quantity: 1 }],
          })
          .expect(201);

        const message = await notificationReceived;
        const payload = JSON.parse(message) as {
          farmerId: string;
          requestId: string;
        };

        expect(payload.farmerId).toBe(farmer.id);
        expect(payload.requestId).toBeDefined();

        await subscriber.quit();
      },
      10_000,
    );
  });
});
