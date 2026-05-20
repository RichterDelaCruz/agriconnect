"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const testing_1 = require("@nestjs/testing");
const request = __importStar(require("supertest"));
const app_module_1 = require("../src/app.module");
const database_1 = require("@agriconnect/database");
const ioredis_1 = require("ioredis");
// ─── Helpers ──────────────────────────────────────────────────────────────────
async function seedTestData() {
    const farmerRepo = database_1.AppDataSource.getRepository('farmer');
    const productRepo = database_1.AppDataSource.getRepository('product');
    const distributorRepo = database_1.AppDataSource.getRepository('distributor');
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
    const distributors = await distributorRepo.save(Array.from({ length: 50 }, (_, i) => ({
        name: `Distributor ${i}`,
        email: `dist${i}@test.com`,
    })));
    return { farmer, product, distributors };
}
// ─── Test Suite ───────────────────────────────────────────────────────────────
describe('AgriConnect E2E', () => {
    let app;
    beforeAll(async () => {
        const moduleFixture = await testing_1.Test.createTestingModule({
            imports: [app_module_1.AppModule],
        }).compile();
        app = moduleFixture.createNestApplication();
        app.setGlobalPrefix('api/v1');
        await app.init();
        if (!database_1.AppDataSource.isInitialized) {
            await database_1.AppDataSource.initialize();
        }
    });
    afterAll(async () => {
        await app.close();
        if (database_1.AppDataSource.isInitialized) {
            await database_1.AppDataSource.destroy();
        }
    });
    // ── Concurrency Test ──────────────────────────────────────────────────────
    describe('POST /api/v1/requests — concurrent request routing', () => {
        it('allows exactly 1 of 50 concurrent requests to succeed when only 1 unit is in stock', async () => {
            const { farmer, product, distributors } = await seedTestData();
            // Fire all 50 requests simultaneously via Promise.all
            const results = await Promise.all(distributors.map((d) => request(app.getHttpServer())
                .post('/api/v1/requests')
                .send({
                distributorId: d.id,
                farmerIds: [farmer.id],
                items: [{ productId: product.id, quantity: 1 }],
            })
                .then((res) => res.status)));
            const successes = results.filter((s) => s === 201);
            const failures = results.filter((s) => s === 400);
            expect(successes).toHaveLength(1);
            expect(failures).toHaveLength(49);
        }, 30_000);
    });
    // ── WebSocket Pub/Sub Test ────────────────────────────────────────────────
    describe('WebSocket real-time notification via Redis Pub/Sub', () => {
        it('delivers a farmer notification within 200ms of request creation', async () => {
            const subscriber = new ioredis_1.Redis({
                host: process.env.REDIS_HOST ?? 'localhost',
                port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
            });
            const notificationReceived = new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Notification not received within 200ms')), 200);
                subscriber.subscribe('farmer_notifications', (err) => {
                    if (err)
                        reject(err);
                });
                subscriber.on('message', (_channel, message) => {
                    clearTimeout(timeout);
                    resolve(message);
                });
            });
            // Seed minimal data for this test
            const farmerRepo = database_1.AppDataSource.getRepository('farmer');
            const productRepo = database_1.AppDataSource.getRepository('product');
            const distributorRepo = database_1.AppDataSource.getRepository('distributor');
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
            const payload = JSON.parse(message);
            expect(payload.farmerId).toBe(farmer.id);
            expect(payload.requestId).toBeDefined();
            await subscriber.quit();
        }, 10_000);
    });
});
//# sourceMappingURL=app.e2e-spec.js.map