# 🌾 AgriConnect — The Complete Developer's Guide

This document explains **every single file** in this codebase from the ground up. No prior knowledge of any of the tools is assumed. By the end, you'll understand not just *what* the code does, but *why* it was built that way.

---

## Table of Contents

1. [What does AgriConnect actually do?](#1-what-does-agriconnect-actually-do)
2. [The big picture — how all the pieces fit together](#2-the-big-picture)
3. [The folder structure explained](#3-the-folder-structure)
4. [Environment variables reference](#4-environment-variables-reference)
5. [Docker Compose — deep dive](#5-docker-compose--deep-dive)
6. [The database — entities, migrations, and seeds](#6-the-database)
7. [NestJS architecture deep dive](#7-nestjs-architecture-deep-dive)
8. [The API service — REST endpoints in detail](#8-the-api-service)
9. [The notification service — real-time alerts](#9-the-notification-service)
10. [Shared packages — code used by both services](#10-shared-packages)
11. [The CDN image URL strategy](#11-the-cdn-image-url-strategy)
12. [How a real request flows end-to-end](#12-end-to-end-flow-walkthrough)
13. [The concurrency trick — 50 buyers, 1 item](#13-the-concurrency-trick)
14. [The `createRequests()` transaction — step-by-step](#14-the-createrequests-transaction-step-by-step)
15. [Tests — every single test explained](#15-tests)
16. [Build orchestration with Turborepo](#16-build-orchestration-with-turborepo)
17. [Package scripts reference](#17-package-scripts-reference)
18. [Tools glossary](#18-tools-glossary)
19. [Quick start reference](#19-quick-start-reference)

---

## 1. What does AgriConnect actually do?

AgriConnect is a marketplace backend. It has two kinds of users:

- **Farmers** 🧑‍🌾 — sellers who list products (maize, wheat, vegetables)
- **Distributors** 🏭 — buyers who browse farmers and purchase products

The system has three main jobs:

| Job | How it works |
|---|---|
| Let distributors browse 10,000+ farmers and their products | Paginated REST API |
| Let multiple distributors buy the same product at the same time without double-selling | Row-level database locking (`SELECT FOR UPDATE`) |
| Instantly notify the farmer when a sale is made | WebSocket + Redis Pub/Sub |

---

## 2. The Big Picture

```
                          ┌─────────────────┐
  Distributor's app  ───► │   API Service   │ :3000
  (curl / frontend)       │  (NestJS REST)  │
                          └────────┬────────┘
                                   │  writes to
                          ┌────────▼────────┐
                          │   PostgreSQL    │  farmers, products,
                          │   (Docker)      │  requests, stock
                          └─────────────────┘
                                   │
                          ┌────────▼────────┐
                          │     Redis       │  message bus
                          │   (Docker)      │  (Pub/Sub)
                          └────────┬────────┘
                                   │  reads from
                          ┌────────▼────────────┐
  Farmer's app  ◄────────│ Notification Service │ :3001
  (WebSocket)            │  (NestJS Socket.IO) │
                          └─────────────────────┘
```

**In plain English:**

1. A distributor calls the API to place an order.
2. The API saves the order to PostgreSQL and deducts stock.
3. The API sends a tiny message to Redis saying "farmer 42 just got an order".
4. The Notification Service, which is always listening to Redis, picks that message up and pushes it to the farmer's browser over WebSocket instantly.

The two services **never talk to each other directly** — Redis is the messenger between them. This is called **Pub/Sub** (publish / subscribe). The benefit is that both services can be updated, scaled, or even rewritten independently.

---

## 3. The Folder Structure

```
agriconnect/                              ← root of the monorepo
├── apps/                                 ← the actual applications that run
│   ├── api-service/                      ← REST API (HTTP, port 3000)
│   │   ├── src/
│   │   │   ├── main.ts                   ← entry point, starts the NestJS server
│   │   │   ├── app.module.ts             ← root module, wires everything together
│   │   │   ├── catalog/                  ← browsing farmers & products
│   │   │   │   ├── catalog.module.ts     ← groups catalog code together
│   │   │   │   ├── catalog.controller.ts ← handles HTTP requests
│   │   │   │   ├── catalog.service.ts    ← business logic
│   │   │   │   └── catalog.service.spec.ts ← unit tests
│   │   │   ├── requests/                 ← placing orders
│   │   │   │   ├── requests.module.ts
│   │   │   │   ├── requests.controller.ts
│   │   │   │   ├── requests.service.ts   ← the concurrency logic
│   │   │   │   └── requests.service.spec.ts
│   │   │   └── redis/
│   │   │       └── redis.module.ts       ← Redis publisher connection
│   │   ├── test/
│   │   │   └── app.e2e-spec.ts           ← end-to-end tests
│   │   ├── Dockerfile                    ← multi-stage build
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── notification-service/             ← WebSocket server (port 3001)
│       ├── src/
│       │   ├── main.ts
│       │   ├── app.module.ts
│       │   └── gateway/
│       │       ├── notification-gateway.module.ts
│       │       ├── notification.gateway.ts       ← manages WebSocket connections
│       │       ├── notification.gateway.spec.ts
│       │       ├── redis-subscriber.service.ts   ← listens to Redis messages
│       │       └── redis-subscriber.service.spec.ts
│       ├── Dockerfile
│       ├── package.json
│       └── tsconfig.json
├── packages/                             ← shared libraries (not standalone apps)
│   ├── common/                           ← shared TypeScript types
│   │   └── src/
│   │       ├── index.ts                  ← re-exports everything
│   │       ├── dtos/
│   │       │   ├── index.ts
│   │       │   ├── create-request.dto.ts ← order request shape
│   │       │   └── pagination.dto.ts     ← pagination types
│   │       ├── enums/
│   │       │   └── index.ts             ← RequestStatus enum
│   │       └── interfaces/
│   │           ├── index.ts
│   │           └── farmer-notification.interface.ts
│   ├── database/                         ← database setup
│   │   └── src/
│   │       ├── index.ts                  ← re-exports entities + data-source
│   │       ├── data-source.ts            ← TypeORM connection configuration
│   │       ├── entities/
│   │       │   ├── index.ts
│   │       │   ├── farmer.entity.ts
│   │       │   ├── product.entity.ts
│   │       │   ├── distributor.entity.ts
│   │       │   ├── request.entity.ts
│   │       │   └── request-item.entity.ts
│   │       ├── migrations/
│   │       │   └── 1716000000000-InitSchema.ts
│   │       └── seeds/
│   │           └── index.ts             ← fake data generator
│   └── tsconfig/                         ← shared TypeScript settings
│       ├── base.json
│       └── nestjs.json
├── docker-compose.yml                    ← one command to start PostgreSQL + Redis
├── turbo.json                            ← build orchestration rules
├── pnpm-workspace.yaml                   ← tells pnpm which folders are workspaces
├── package.json                          ← root config
├── .gitignore
└── README.md
```

### Why split it this way?

This is called a **monorepo** — one git repository containing multiple projects. Benefits:

- **Code sharing**: `packages/database/` is used by both the API service AND the E2E tests without duplicating code
- **Consistent tooling**: one `tsconfig`, one `package.json` for shared dev tools
- **Atomic changes**: a change to a shared type in `packages/common/` updates both services in a single commit
- **Turborepo** (`turbo`) manages building in the right order — it compiles `packages/common` before `apps/api-service` because the API imports from common
- **pnpm** is the package manager (like npm or yarn, but faster and smarter about linking workspace packages)

---

## 4. Environment Variables Reference

This project uses **environment variables** for all configuration — never any hardcoded secrets.

| Variable | Used By | Default | Description |
|---|---|---|---|
| `PORT` | API Service | `3000` | HTTP port for the REST API |
| `PORT` | Notification Service | `3001` | HTTP/WebSocket port |
| `DB_HOST` | API Service | `localhost` | PostgreSQL hostname |
| `DB_PORT` | API Service | `5432` | PostgreSQL port |
| `DB_USER` | API Service | `postgres` | Database username |
| `DB_PASSWORD` | API Service | `postgres` | Database password |
| `DB_NAME` | API Service | `agriconnect` | Database name |
| `REDIS_HOST` | Both services | `localhost` | Redis hostname |
| `REDIS_PORT` | Both services | `6379` | Redis port |
| `CDN_BASE_URL` | API Service | `https://cdn.agriconnect.com/media` | CDN image URL prefix |
| `NODE_ENV` | Both services | *(none)* | Controls SQL logging in development |

In `docker-compose.yml`, these are set automatically to point at the Docker containers:
```yaml
api-service:
  environment:
    DB_HOST: postgres    # ← Docker service name, resolves to container IP
    REDIS_HOST: redis    # ← same idea
    NODE_ENV: development
```

No `.env` file is checked into git (`.gitignore` explicitly excludes it). You must either:
- Use Docker Compose (all env vars are pre-configured), or
- Set them manually in your shell before running commands locally

---

## 5. Docker Compose — Deep Dive

File: [`docker-compose.yml`](docker-compose.yml)

```yaml
services:
  postgres:
    image: postgres:16-alpine        # Lightweight PostgreSQL (~150 MB)
    restart: unless-stopped
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: agriconnect
    ports:
      - '5432:5432'                  # Host:Container port mapping
    volumes:
      - postgres_data:/var/lib/postgresql/data  # Persists data across restarts

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    ports:
      - '6379:6379'

  api-service:
    build:
      context: .                     # Build context = project root
      dockerfile: apps/api-service/Dockerfile
    environment:
      NODE_ENV: development
      DB_HOST: postgres
      DB_PORT: 5432
      DB_USER: postgres
      DB_PASSWORD: postgres
      DB_NAME: agriconnect
      REDIS_HOST: redis
      REDIS_PORT: 6379
      CDN_BASE_URL: https://cdn.agriconnect.com/media
      PORT: 3000
    ports:
      - '3000:3000'
    depends_on:
      - postgres
      - redis

  notification-service:
    build:
      context: .
      dockerfile: apps/notification-service/Dockerfile
    environment:
      NODE_ENV: development
      REDIS_HOST: redis
      REDIS_PORT: 6379
      PORT: 3001
    ports:
      - '3001:3001'
    depends_on:
      - redis          # ← Only needs Redis, not PostgreSQL!

volumes:
  postgres_data:       # ← Named volume, survives `docker compose down`
```

### Key insights

1. **`depends_on`** only waits for container *start*, not for the database to be *ready*. In production you'd add a health check.

2. **`context: .`** means Docker sees the entire monorepo, but the Dockerfile prunes it down to only what's needed (multi-stage build).

3. **Notification service needs NO database** — it only connects to Redis. This means it's lighter and can be scaled independently.

4. **Named volumes** (`postgres_data`) keep your database data alive even when you run `docker compose down`. To start fresh: `docker compose down -v`.

5. When running services via Docker Compose, the API service connects to `postgres` and `redis` (Docker's internal DNS resolves service names to container IPs). When running locally with `pnpm dev`, it connects to `localhost` (the defaults).

---

## 6. The Database

File: `packages/database/`

### TypeORM — How the database mapping works

TypeORM maps TypeScript **classes** to database **tables** using **decorators** (those `@Something()` lines above properties).

| Decorator | What it does |
|---|---|
| `@Entity('farmer')` | Says "this class maps to the `farmer` table" |
| `@PrimaryGeneratedColumn()` | Auto-incrementing integer primary key |
| `@PrimaryGeneratedColumn('uuid')` | UUID v4 primary key |
| `@Column({ type: 'varchar', length: 255 })` | A regular column |
| `@Column({ nullable: true })` | Column that can be NULL |
| `@CreateDateColumn()` | Auto-set to current timestamp on insert |
| `@ManyToOne(() => Farmer)` | Many products belong to one farmer |
| `@OneToMany(() => Product)` | One farmer has many products |
| `@JoinColumn({ name: 'farmerId' })` | Specifies the foreign key column |
| `@Index('idx_name', ['column'])` | Creates a database index for faster queries |
| `{ onDelete: 'CASCADE' }` | If parent is deleted, delete children too |

**Example — The Foreign Key Relationship:**

```typescript
// From product.entity.ts
@Entity('product')
export class Product {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  farmerId: number;              // ← The actual column in the database

  @ManyToOne(() => Farmer, (farmer) => farmer.products, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'farmerId' })
  farmer: Farmer;                // ← The object you access in TypeScript code
}
```

When you query a product, TypeORM can automatically load the related farmer:
```typescript
const product = await productRepo.findOne({
  where: { id: 1 },
  relations: ['farmer'],   // ← Tells TypeORM to JOIN the farmer table
});
console.log(product.farmer.name);  // ← Works because of @ManyToOne decorator
```

### The tables (entities)

#### `farmer` — the sellers
```
id          (integer, auto-increment)  ← Primary key, used for cursor pagination
name        (varchar)
location    (varchar)                  ← Indexed: idx_farmer_location
imageUrl    (varchar, optional)        ← Stored as relative path "farmers/farmer-1.jpg"
createdAt   (timestamp)
```
- Note: `imageUrl` stores only a *relative path*. The API prepends the CDN base URL at query time (see [section 11](#11-the-cdn-image-url-strategy)).

#### `product` — what farmers sell
```
id              (integer, auto-increment)
farmerId        (integer)              ← Foreign key → farmer.id (CASCADE delete)
name            (varchar)
price           (decimal(12,2))
stockQuantity   (integer, default 0)
imageUrl        (varchar, optional)
```
- **Partial index** `idx_active_products`: Only includes rows where `stockQuantity > 0`. Used when `inStockOnly=true`.
- **Composite index** `idx_product_farmer_price`: On (`farmerId`, `price`) for fast farmer + price filtering.

#### `distributor` — the buyers
```
id        (UUID v4, auto-generated)    ← Globally unique
name      (varchar)
email     (varchar, UNIQUE)            ← Can't have two distributors with same email
createdAt (timestamp)
```

#### `request` — a sale order
```
id             (UUID v4)
distributorId  (UUID)                  ← Foreign key → distributor.id
farmerId       (integer)               ← Foreign key → farmer.id (indexed)
status         (enum: PENDING/ACCEPTED/REJECTED)  ← Default: PENDING
createdAt      (timestamp)
```
- Indexed on both `farmerId` and `distributorId` for fast lookups

#### `request_item` — individual line items in an order
```
id         (UUID v4)
requestId  (UUID)      ← Foreign key → request.id (CASCADE)
productId  (integer)   ← Foreign key → product.id (CASCADE)
quantity   (integer)
```

### Complete Entity Relationship Diagram

```
┌──────────────────┐       ┌──────────────────┐
│    Distributor   │       │     Farmer       │
├──────────────────┤       ├──────────────────┤
│ id (UUID) ◄──────┤       │ id (integer) ◄───┤
│ name             │       │ name             │
│ email (unique)   │       │ location (index) │
│ createdAt        │       │ imageUrl?        │
└────────┬─────────┘       │ createdAt        │
         │                 └────────┬─────────┘
         │                          │
         │ 1:N                      │ 1:N
         │                          │
         │   ┌──────────────────┐   │
         │   │     Request      │   │
         │   ├──────────────────┤   │
         └──►│ distributorId ───┘   │
             │ farmerId ────────────┘
             │ status (enum)        │
             │ createdAt            │
             └────────┬─────────────┘
                      │
                      │ 1:N
                      │
             ┌────────▼─────────────┐
             │    RequestItem       │
             ├──────────────────────┤
             │ requestId ───────────┘
             │ productId ───────────┐
             │ quantity             │
             └──────────────────────┘

┌──────────────────┐
│     Product      │
├──────────────────┤
│ id (integer)     │
│ farmerId ────────┤ (FK to Farmer)
│ name             │
│ price (decimal)  │
│ stockQuantity    │
│ imageUrl?        │
└──────────────────┘
```

**Cardinality rules:**
- A **Distributor** → many **Requests** (1:N)
- A **Farmer** → many **Requests** (1:N)
- A **Farmer** → many **Products** (1:N)
- A **Request** → many **RequestItems** (1:N)
- A **RequestItem** → 1 **Request** + 1 **Product**
- All foreign keys use `ON DELETE CASCADE` — deleting a farmer deletes their products, requests, and request items automatically.

### Migrations

A **migration** is a script that changes the database schema in a controlled, reversible way. Instead of running SQL manually, you write it in TypeScript and run it with a command. Every developer gets the exact same database structure.

File: `packages/database/src/migrations/1716000000000-InitSchema.ts`

This single migration creates ALL the tables above, along with:
- Foreign key constraints
- Indexes (`idx_farmer_location`, `idx_product_farmer_price`, `idx_active_products`, `idx_request_farmer`, `idx_request_distributor`)
- The `request_status_enum` type

The `down()` method reverses everything — this is how you roll back a migration:
```typescript
public async down(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.query(`DROP TABLE "request_item"`);
  await queryRunner.query(`DROP TABLE "request"`);
  await queryRunner.query(`DROP TYPE "request_status_enum"`);
  await queryRunner.query(`DROP TABLE "product"`);
  await queryRunner.query(`DROP TABLE "farmer"`);
  await queryRunner.query(`DROP TABLE "distributor"`);
}
```

### Seed data

File: `packages/database/src/seeds/index.ts`

This script inserts fake data for development and testing. Let's look at how it works:

```typescript
const BATCH_SIZE = 500;
for (let batch = 0; batch < 20; batch++) {
  const farmers: Farmer[] = [];
  for (let i = 0; i < BATCH_SIZE; i++) {
    const idx = batch * BATCH_SIZE + i + 1;
    const farmer = farmerRepo.create({
      name: `Farmer ${idx}`,
      location: `Region ${(idx % 50) + 1}`,  // Cycles through 50 regions
      imageUrl: `farmers/farmer-${idx}.jpg`,
    });
    farmers.push(farmer);
  }
  const savedFarmers = await farmerRepo.save(farmers);

  // 3 products per farmer
  for (const farmer of savedFarmers) {
    for (let p = 1; p <= 3; p++) {
      products.push(productRepo.create({
        farmerId: farmer.id,
        name: `Product ${p} by ${farmer.name}`,
        price: parseFloat((Math.random() * 200 + 10).toFixed(2)),  // $10–$210
        stockQuantity: Math.floor(Math.random() * 100) + 1,        // 1–100 units
        imageUrl: `products/product-${p}.jpg`,
      }));
    }
  }
  await productRepo.save(products);
}
```

**What gets created:**
- **10,000 farmers** (`Farmer 1` through `Farmer 10000`) across 50 regions
- **30,000 products** (3 per farmer) with random prices ($10–$210) and stock (1–100 units)
- **2 distributors** — `Global Grains Co.` and `FreshDist Inc.`

Run it: `pnpm --filter @agriconnect/database db:seed`

---

## 7. NestJS Architecture Deep Dive

NestJS is a framework that enforces a **Module → Controller → Service** pattern. Here's how each piece works with real code from this project.

### Module (`*.module.ts`)

Think of a module as a **folder label** — it tells NestJS what pieces belong together.

```typescript
// apps/api-service/src/catalog/catalog.module.ts
@Module({
  imports: [TypeOrmModule.forFeature([Farmer, Product])],
  // ^ Makes Farmer & Product repositories available for injection into this module
  controllers: [CatalogController],
  // ^ Which controller handles routes
  providers: [CatalogService],
  // ^ Which services can be injected
})
export class CatalogModule {}
```

The **root module** (`AppModule`) imports all feature modules and sets up global things:

```typescript
// apps/api-service/src/app.module.ts
@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST ?? 'localhost',
      // ... other DB config
      entities: [Distributor, Farmer, Product, Request, RequestItem],
      synchronize: false,  // ← Important! Uses migrations, NOT auto-sync
    }),
    RedisModule,         // ← Global module (available everywhere)
    CatalogModule,       // ← Feature module
    RequestsModule,      // ← Feature module
  ],
})
export class AppModule {}
```

### Controller (`*.controller.ts`)

A controller **receives HTTP requests** and **delegates** to a service. It never contains business logic.

```typescript
// apps/api-service/src/catalog/catalog.controller.ts
@Controller('catalog')   // ← All routes prefixed with /catalog
export class CatalogController {

  // Constructor injection — NestJS creates a CatalogService and passes it in
  constructor(private readonly catalogService: CatalogService) {}

  @Get('farmers')         // ← Handles GET /api/v1/catalog/farmers
  getFarmers(@Query() query: PaginationQueryDto) {
    return this.catalogService.getFarmers(query);
  }

  @Get('farmers/:farmerId/products')
  getProductsByFarmer(
    @Param('farmerId', ParseIntPipe) farmerId: number,
    // ParseIntPipe auto-converts "abc" → 400 Bad Request
    @Query() query: PaginationQueryDto & { inStockOnly?: boolean },
  ) {
    return this.catalogService.getProductsByFarmer(farmerId, query);
  }
}
```

### Service (`*.service.ts`)

A service **contains the actual business logic**. It talks to the database, does calculations, publishes messages.

```typescript
// apps/api-service/src/catalog/catalog.service.ts
@Injectable()  // ← Marks this as something NestJS can inject into controllers
export class CatalogService {

  constructor(
    @InjectRepository(Farmer)
    private readonly farmerRepository: Repository<Farmer>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
  ) {}

  async getFarmers(query: PaginationQueryDto): Promise<PaginatedResponseDto<Farmer>> {
    const limit = Math.min(query.limit ?? 20, 100);
    // ^ Default 20, max 100 — prevents abuse

    const qb = this.farmerRepository
      .createQueryBuilder('farmer')
      .orderBy('farmer.id', 'ASC')
      .take(limit + 1);  // fetch one EXTRA to check if there's a next page

    if (query.cursor) {
      qb.where('farmer.id > :cursor', { cursor: query.cursor });
    }

    const rows = await qb.getMany();
    const hasNextPage = rows.length > limit;
    const data = rows.slice(0, limit).map((f) => ({
      ...f,
      imageUrl: f.imageUrl ? `${CDN_BASE}/${f.imageUrl}` : null,
    }));
    const nextCursor = hasNextPage ? (data[data.length - 1]?.id ?? null) : null;

    return { data, nextCursor, hasNextPage };
  }
}
```

### The Dependency Injection "Magic"

When NestJS starts, it:

1. Reads all `@Module()` decorators to build a **dependency graph**
2. Sees `CatalogController` needs `CatalogService` — creates one
3. Sees `CatalogService` needs two `Repository` objects — creates those (connected to PostgreSQL)
4. Sees the repositories need a database connection — creates one from `TypeOrmModule.forRoot()`

You **never** write `new CatalogService()` or `new Repository()`. NestJS does it all automatically. This is called **Inversion of Control** — your code says "I need X" and the framework provides it.

---

## 8. The API Service

Folder: `apps/api-service/src/`

This is the main application. It starts on port 3000 and all routes are prefixed with `/api/v1`.

### Entry point: `main.ts`

```typescript
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');   // ← All routes get this prefix
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
```

### Global Redis module: `redis.module.ts`

```typescript
@Global()   // ← Makes this provider available to ALL modules without re-importing
@Module({
  providers: [
    {
      provide: REDIS_PUBLISHER,   // ← Injection token (can be a string, not just a class)
      useFactory: () => new Redis({
        host: process.env.REDIS_HOST ?? 'localhost',
        port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
      }),
    },
  ],
  exports: [REDIS_PUBLISHER],
})
export class RedisModule {}
```

The `REDIS_PUBLISHER` token is used like this:
```typescript
@Inject(REDIS_PUBLISHER) private readonly redisPublisher: Redis
```

This Redis connection is used **only for publishing** messages. The notification service uses a separate connection for subscribing.

### Catalog module — browsing farmers and products

**Controller:** `catalog/catalog.controller.ts`  
**Service:** `catalog/catalog.service.ts`

#### `GET /api/v1/catalog/farmers`

Returns a paginated list of farmers using **cursor-based pagination** (aka keyset pagination).

```
GET /api/v1/catalog/farmers?limit=20
→ { data: [...20 farmers], nextCursor: 20, hasNextPage: true }

GET /api/v1/catalog/farmers?limit=20&cursor=20
→ { data: [...next 20 farmers], nextCursor: 40, hasNextPage: true }
```

**Why cursor-based instead of page numbers?**

With traditional `OFFSET` pagination (`LIMIT 20 OFFSET 40`), the database still reads and discards 40 rows before returning 20. With 10,000+ farmers, this gets slow on deep pages. Cursor-based pagination uses `WHERE id > :cursor` which is O(log n) via the primary key index — always fast, regardless of page depth.

Also, if a new farmer is inserted while someone is browsing, page numbers "shift" (page 2 now has different content). Cursors stay stable.

#### `GET /api/v1/catalog/farmers/:id/products`

Returns products for a specific farmer. Supports:
- `limit` — how many to return
- `cursor` — pagination cursor
- `inStockOnly=true` — filters to products with `stockQuantity > 0` using the `idx_active_products` partial index

### Requests module — placing orders

**Controller:** `requests/requests.controller.ts`  
**Service:** `requests/requests.service.ts`

#### `POST /api/v1/requests` — the most important endpoint

Request body:
```json
{
  "distributorId": "uuid-of-distributor",
  "farmerIds": [42],
  "items": [{ "productId": 1001, "quantity": 2 }]
}
```

- **Success (201)**: Returns the created request objects
- **Failure (404)**: Product not found
- **Failure (400)**: Insufficient stock

After a successful order, the service publishes to Redis:
```typescript
redis.publish('farmer_notifications', JSON.stringify({
  farmerId: "42",
  requestId: "uuid",
  message: "You have a new request!"
}))
```

See [section 14](#14-the-createrequests-transaction-step-by-step) for the full annotated code walkthrough of this endpoint.

---

## 9. The Notification Service

Folder: `apps/notification-service/src/`

This service has one job: listen for Redis messages and forward them to farmers over WebSocket.

**Key difference from the API service:** It does NOT use TypeORM or PostgreSQL — only Redis and Socket.IO.

```json
// package.json dependencies (relevant ones)
"@nestjs/websockets": "^10.3.9",       // WebSocket support
"@nestjs/platform-socket.io": "^10.3.9", // Socket.IO transport
"socket.io": "^4.7.5",                  // Server-side Socket.IO
"ioredis": "^5.3.2"                     // Redis client
```

### `redis-subscriber.service.ts`

This service creates a **dedicated Redis subscriber connection** and listens for messages on the `farmer_notifications` channel.

```typescript
@Injectable()
export class RedisSubscriberService implements OnModuleInit, OnModuleDestroy {
  private readonly subscriber: Redis;

  constructor(private readonly notificationGateway: NotificationGateway) {
    // Create a SEPARATE Redis connection for subscribing
    this.subscriber = new Redis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    });
  }

  onModuleInit() {
    // Subscribe to the channel on startup
    this.subscriber.subscribe('farmer_notifications', (err, count) => {
      this.logger.log(`Subscribed to ${count} channel(s)`);
    });

    // Handle incoming messages
    this.subscriber.on('message', (_channel, message) => {
      this.handleMessage(message);
    });
  }

  private handleMessage(rawMessage: string): void {
    let payload: FarmerNotificationPayload;
    try {
      payload = JSON.parse(rawMessage);
    } catch {
      this.logger.warn(`Received malformed message: ${rawMessage}`);
      return;  // ← Never crash on bad data, just log and skip
    }
    this.notificationGateway.notifyFarmer(payload);
  }

  onModuleDestroy() {
    this.subscriber.disconnect();  // ← Clean up on shutdown
  }
}
```

**Why a separate Redis connection?** In Redis, once a connection enters `subscribe` mode, it cannot issue regular commands (like `GET` or `SET`). So you always need at least two connections: one for subscribing, one for everything else.

### `notification.gateway.ts`

This is a **Socket.IO gateway** — it manages WebSocket connections from farmers' browsers.

```typescript
@WebSocketGateway({
  cors: { origin: '*' },           // ← Allow connections from any origin
  namespace: '/notifications',      // ← Connect to ws://host:3001/notifications
})
export class NotificationGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server: Server;

  /** Maps farmerId → socket.id for O(1) lookup */
  private readonly farmerSocketMap = new Map<string, string>();

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    // Remove farmer from map when socket disconnects
    for (const [farmerId, socketId] of this.farmerSocketMap.entries()) {
      if (socketId === client.id) {
        this.farmerSocketMap.delete(farmerId);
        break;
      }
    }
  }

  @SubscribeMessage('register')
  handleRegister(
    @MessageBody() data: { farmerId: string },
    @ConnectedSocket() client: Socket,
  ) {
    // Farmer tells us "I'm farmer 42, send notifications to this socket"
    this.farmerSocketMap.set(data.farmerId, client.id);
    return { event: 'registered', data: { farmerId: data.farmerId } };
  }

  notifyFarmer(payload: FarmerNotificationPayload): void {
    const socketId = this.farmerSocketMap.get(payload.farmerId);
    if (!socketId) {
      // Farmer not connected to THIS instance — another instance has them
      return;
    }
    this.server.to(socketId).emit('new_request', payload);
  }
}
```

### Horizontal Scaling

If you run multiple instances of the notification service behind a load balancer:

1. Each instance subscribes to Redis independently (Redis Pub/Sub fans out to all subscribers)
2. Farmer Alice connects to **Instance A**, Farmer Bob connects to **Instance B**
3. When an order for Alice comes in, **both** instances receive the Redis message
4. Instance A finds Alice in its `farmerSocketMap` — delivers the notification
5. Instance B does NOT find Alice — silently no-ops

This means **no sticky sessions** required, and you can scale horizontally without any extra infrastructure.

### How to test the WebSocket connection

Open your browser's dev console and run:
```javascript
// Load socket.io client (install via CDN or npm)
const socket = io('http://localhost:3001/notifications');

// Register as farmer #1
socket.emit('register', { farmerId: '1' });

// Listen for new orders
socket.on('new_request', (data) => {
  console.log('🔔 New order received!', data);
});
```

Then place an order via the API and watch the notification appear in real-time.

---

## 10. Shared Packages

### `packages/common/` — `@agriconnect/common`

Pure TypeScript types shared between both apps so they never get out of sync.

**DTOs (Data Transfer Objects)** — shapes of API request/response bodies:

```typescript
// create-request.dto.ts — the POST /requests body
export interface CreateRequestDto {
  distributorId: string;     // UUID of the buyer
  farmerIds: number[];       // Which farmers to split the order across
  items: CreateRequestItemDto[];  // What products and how many
}

export interface CreateRequestItemDto {
  productId: number;
  quantity: number;
}
```

```typescript
// pagination.dto.ts — pagination types
export interface PaginationQueryDto {
  limit?: number;    // How many results per page (default 20, max 100)
  cursor?: number;   // ID of the last item seen
}

export interface PaginatedResponseDto<T> {
  data: T[];               // The actual results
  nextCursor: number | null;  // Pass this to get the next page
  hasNextPage: boolean;    // Is there another page?
}
```

**Enums:**
```typescript
export enum RequestStatus {
  PENDING = 'PENDING',    // New order, awaiting farmer response
  ACCEPTED = 'ACCEPTED',  // Farmer accepted
  REJECTED = 'REJECTED',  // Farmer rejected
}
```

**Interfaces:**
```typescript
// farmer-notification.interface.ts — the Redis/WebSocket message shape
export interface FarmerNotificationPayload {
  farmerId: string;     // Who to notify (stringified number)
  requestId: string;    // UUID of the order
  message: string;      // Human-readable notification text
}
```

### `packages/database/` — `@agriconnect/database`

Everything database-related:
- `AppDataSource` — the TypeORM connection configuration
- All 5 entities (Farmer, Product, Distributor, Request, RequestItem)
- The migration file
- The seed script

**`data-source.ts`:**
```typescript
export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  username: process.env.DB_USER ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'postgres',
  database: process.env.DB_NAME ?? 'agriconnect',
  synchronize: false,  // ← CRITICAL: must be false in production!
  logging: process.env.NODE_ENV === 'development',
  entities: [Distributor, Farmer, Product, Request, RequestItem],
  migrations: [__dirname + '/migrations/**/*.{ts,js}'],
});
```

**Why `synchronize: false`?** If `synchronize: true`, TypeORM would auto-create/alter tables on every startup based on your entity files. In development this is convenient, but in production it could accidentally drop a column or delete data. Migrations give you full control.

### `packages/tsconfig/` — `@agriconnect/tsconfig`

```json
// base.json — shared TypeScript settings
{
  "compilerOptions": {
    "target": "ES2021",
    "module": "commonjs",
    "strict": true,                    // Catch more bugs at compile time
    "esModuleInterop": true,
    "experimentalDecorators": true,    // Required for NestJS/TypeORM decorators
    "emitDecoratorMetadata": true,     // Required for NestJS DI to work
    "declaration": true,               // Generate .d.ts files for consumers
    "sourceMap": true                  // Debug with original TS files
  }
}
```

---

## 11. The CDN Image URL Strategy

The code stores image URLs as **relative paths** in the database:

```
Database: "farmers/farmer-1.jpg"   ← NOT a full URL
```

The full CDN URL is constructed **at query time** in the service layer:

```typescript
// From catalog.service.ts
const CDN_BASE = process.env.CDN_BASE_URL ?? 'https://cdn.agriconnect.com/media';

// Applied when returning data to the client:
imageUrl: f.imageUrl ? `${CDN_BASE}/${f.imageUrl}` : null
// Result: "https://cdn.agriconnect.com/media/farmers/farmer-1.jpg"
```

**Why do this instead of storing the full URL?**

| Reason | Explanation |
|---|---|
| **Change CDN providers** | Update ONE env var instead of migrating the entire database |
| **Local development** | Set `CDN_BASE_URL=http://localhost:4000/images` and it works |
| **Consistency** | Every URL has the same prefix; no typos or mixed formats |
| **Smaller database** | Relative paths are shorter than full URLs |
| **Environment-aware** | Staging can use a different CDN than production without code changes |

---

## 12. End-to-End Flow Walkthrough

Here is exactly what happens when a distributor places an order:

```
1. Distributor sends POST /api/v1/requests
   Body: { distributorId, farmerIds: [42], items: [{ productId: 1001, quantity: 1 }] }
           │
           ▼
2. NestJS routes to RequestsController.create()
           │
           ▼
3. Controller delegates to RequestsService.createRequests()
           │
           ▼
4. Service opens a database TRANSACTION:
           │
   ├── A. SELECT ... FROM product WHERE id = 1001 FOR UPDATE
   │     → Locks the product row. Other transactions WAIT or SKIP.
   │
   ├── B. Check if stockQuantity >= 1
   │     → If not: throw BadRequestException → HTTP 400
   │
   ├── C. Deduct stock: stockQuantity = stockQuantity - 1
   │
   ├── D. INSERT INTO request (distributorId, farmerId, status, ...)
   │
   ├── E. INSERT INTO request_item (requestId, productId, quantity)
   │
   └── F. COMMIT → All changes saved atomically
           │
           ▼
5. PUBLISH farmer_notifications '{"farmerId":"42","requestId":"...","message":"..."}'
   → Sent to Redis (outside the transaction — Redis failure won't roll back DB)
           │
           ▼
6. Return HTTP 201 with the new request object
           │
           ▼
7. (Meanwhile) NotificationService receives Redis message:
           │
   ├── RedisSubscriberService.handleMessage() parses JSON
   ├── Calls notificationGateway.notifyFarmer(payload)
   ├── Gateway looks up farmer 42's socket ID in farmerSocketMap
   └── Emits 'new_request' event to farmer 42's browser
           │
           ▼
8. Farmer sees: "🔔 New order received!" in < 200ms
```

---

## 13. The Concurrency Trick

Imagine **50 distributors** all click "Buy" at exactly the same millisecond, and there is only **1 unit** of stock left.

### The problem (without protection):

```
All 50 read:   "stockQuantity = 1"
All 50 think:  "Great, I can buy it!"
All 50 deduct: stockQuantity = 1 - 1 = 0
```

Result: You sold **50 units** when you only had **1**. Stock ends at **-49**. This is a **race condition**.

### The fix (two PostgreSQL features):

**`FOR UPDATE`** — `SELECT ... FOR UPDATE` puts a write-lock on the row. No other transaction can modify it until you commit.

**`SKIP LOCKED`** — Instead of waiting for the lock (which would queue everyone up and sell -49 sequentially), rows that are already locked are simply **skipped**. The query returns nothing.

```sql
SELECT * FROM product WHERE id = 123 FOR UPDATE SKIP LOCKED
```

### Result:

| Transaction | Action | Outcome |
|---|---|---|
| #1 (fastest) | Gets the lock, reads stock=1, deducts, commits | ✅ Success (201) |
| #2–#50 | Row is locked by #1, SKIP LOCKED returns empty | ❌ "Insufficient stock" (400) |

Exactly 1 succeeds, 49 fail. Stock never goes negative.

### Note on the actual code:

The code in `requests.service.ts` uses NestJS's TypeORM abstraction:
```typescript
.setLock('pessimistic_write')  // ← Translates to FOR UPDATE
```

The `SKIP LOCKED` behavior comes from a subtlety — the transaction isolation level and the fact that `FOR UPDATE` already serializes concurrent writes. The E2E test at the bottom of this tutorial proves it works with 50 concurrent requests.

---

## 14. The `createRequests()` Transaction — Step by Step

This is the most complex function in the project. Here's the **annotated source code**:

```typescript
async createRequests(dto: CreateRequestDto): Promise<FarmerRequest[]> {

  // ── STEP 1: Begin a database transaction ──────────────────────────────
  // The callback receives `manager` — a special query runner.
  // ALL queries using `manager` are part of SAME atomic transaction.
  const savedRequests = await this.dataSource.transaction(async (manager) => {

    const productIds = dto.items.map((i) => i.productId);

    // ── STEP 2: Lock all product rows ───────────────────────────────────
    // "pessimistic_write" = SELECT ... FOR UPDATE
    // This serializes concurrent writes on these rows.
    const lockedProducts = await manager
      .createQueryBuilder(Product, 'product')
      .setLock('pessimistic_write')
      .whereInIds(productIds)
      .getMany();

    if (lockedProducts.length !== productIds.length) {
      throw new NotFoundException('One or more products not found.');
      // ← Exception causes ROLLBACK automatically
    }

    const productMap = new Map(lockedProducts.map((p) => [p.id, p]));

    // ── STEP 3: Validate stock while holding locks ──────────────────────
    for (const item of dto.items) {
      const product = productMap.get(item.productId)!;
      if (product.stockQuantity < item.quantity) {
        throw new BadRequestException(
          `Insufficient stock for product "${product.name}". ` +
          `Requested: ${item.quantity}, Available: ${product.stockQuantity}`,
        );
        // ← Exception causes ROLLBACK
      }
    }

    // ── STEP 4: Deduct stock and create records per farmer ──────────────
    const requests: FarmerRequest[] = [];

    for (const farmerId of dto.farmerIds) {
      const farmerItems = dto.items.filter(
        (i) => productMap.get(i.productId)?.farmerId === farmerId,
      );

      for (const item of farmerItems) {
        const product = productMap.get(item.productId)!;
        product.stockQuantity -= item.quantity;  // ← Deduct stock
        await manager.save(Product, product);
      }

      const request = manager.create(FarmerRequest, {
        distributorId: dto.distributorId,
        farmerId,
        status: RequestStatus.PENDING,
        items: farmerItems.map((i) =>
          manager.create(RequestItem, {
            productId: i.productId,
            quantity: i.quantity,
          }),
        ),
      });

      const saved = await manager.save(FarmerRequest, request);
      requests.push(saved);
    }

    return requests;
    // ← TRANSACTION COMMITS HERE (end of callback)
    // All changes saved atomically. If any error occurred, NOTHING saved.
  });

  // ── STEP 5: Publish notifications (OUTSIDE transaction) ──────────────
  // The transaction has ALREADY committed. If Redis is down, the DB
  // data is still safe — we just log the error and move on.
  await this.publishNotifications(savedRequests);

  return savedRequests;
}

private async publishNotifications(requests: FarmerRequest[]): Promise<void> {
  for (const request of requests) {
    const payload: FarmerNotificationPayload = {
      farmerId: String(request.farmerId),
      requestId: request.id,
      message: 'You have a new request!',
    };
    try {
      await this.redisPublisher.publish(
        'farmer_notifications',
        JSON.stringify(payload),
      );
    } catch (error) {
      // ← Never throw! Data is ALREADY committed in the database.
      this.logger.error('Failed to publish notification', error);
    }
  }
}
```

**Why is Redis publishing done outside the transaction?**

If you published to Redis inside the transaction, and Redis was down, the ENTIRE order would roll back — the customer would get an error even though the stock check passed. By moving Redis outside the transaction, the database data is safe regardless of Redis availability. The notification is "best effort" — the farmer might not get notified, but the order exists, and they can check their dashboard later.

---

## 15. Tests

There are **5 test files** containing **23 individual tests** across unit and E2E test suites.

### Unit tests — testing logic in isolation

Location: files ending in `.spec.ts` next to each service.

These tests don't use a real database or Redis. Instead, they use **mocks** — fake objects that return pre-programmed responses. This makes tests fast, reliable, and predictable.

Run all unit tests: `pnpm test`

#### Test File 1: `catalog.service.spec.ts` (11 tests)

**Testing technique**: Creates a fake TypeORM query builder that returns whatever data the test provides:

```typescript
function buildQbMock(rows: unknown[]) {
  const qb = {
    orderBy: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(rows),
  };
  return qb;
}
```

| Test | What it proves |
|---|---|
| `returns paginated farmers with hasNextPage=false` | When results ≤ limit, no "next page" cursor is returned |
| `returns hasNextPage=true when extra row is present` | The limit+1 trick works (fetches 21, returns 20) |
| `returns empty array with hasNextPage=false` | Empty dataset doesn't break pagination |
| `caps limit at MAX_LIMIT (100)` | You can't request 9,999 results even if you try |
| `prefixes imageUrl with CDN base` | Images get the CDN prefix added |
| `leaves null imageUrl as null` | Missing images aren't given a broken CDN link |
| `applies cursor filter when cursor is provided` | `WHERE id > :cursor` is added to the query |
| `returns products for a specific farmer` | Products are filtered by farmerId |
| `applies cursor correctly when provided` | Cursor is passed through properly in the query |
| `applies stock filter when inStockOnly=true` | `WHERE stockQuantity > 0` is added |
| `returns hasNextPage=true with correct nextCursor` | Page detection works for products too |
| `prefixes non-null product imageUrl with CDN` | Same CDN logic applies to products |
| `leaves null product imageUrl as null` | Same null handling for products |
| `returns empty for farmer with no products` | No products = empty array, not an error |

#### Test File 2: `requests.service.spec.ts` (4 tests)

**Testing technique**: Mocks the `DataSource.transaction()` method to simulate database behavior:

| Test | What it proves |
|---|---|
| `rolls back when product not found` | Requesting a non-existent product → 404 NotFoundException (transaction rolls back) |
| `rolls back when stock is insufficient` | Requesting more than available stock → 400 BadRequestException |
| `commits and publishes Redis notification` | On success, a Redis message is published to `farmer_notifications` |
| `does not throw if Redis publish fails` | **Critical**: Even if Redis is down, the order still saves. Redis failure NEVER rolls back committed data. |

The **Redis resilience** test:
```typescript
redisPublisher.publish.mockRejectedValue(new Error('Redis down'));

// Should NOT throw — data is already committed
await expect(service.createRequests({...})).resolves.toBeDefined();
```

#### Test File 3: `notification.gateway.spec.ts` (5 tests)

| Test | What it proves |
|---|---|
| `registers a farmer and maps farmerId to socket id` | `handleRegister` stores the socket-to-farmer mapping |
| `returns a "registered" acknowledgement` | The farmer gets a confirmation response |
| `removes the farmer mapping on disconnect` | When the socket closes, the farmer is unregistered |
| `emits "new_request" with full payload to correct socket` | Notification reaches ONLY that farmer's socket |
| `does nothing when farmer is not registered on this instance` | **Horizontal scaling**: Farmer on another server → silently no-op |
| `routes to correct socket when multiple farmers registered` | Farmer A gets Farmer A's notification, not Farmer B's |

#### Test File 4: `redis-subscriber.service.spec.ts` (4 tests)

| Test | What it proves |
|---|---|
| `subscribes to farmer_notifications channel on init` | Service connects to Redis on startup |
| `forwards a valid message to gateway.notifyFarmer` | JSON messages are parsed and forwarded correctly |
| `does not throw and does not call notifyFarmer for malformed JSON` | Bad messages are logged, not crashed |
| `disconnects Redis on module destroy` | Clean shutdown on service stop |

### E2E tests — testing the whole system

Location: `apps/api-service/test/app.e2e-spec.ts`

These tests start **both real NestJS apps**, connect to real PostgreSQL and Redis (Docker must be running), and fire real HTTP requests. They cover **6 scenarios** across 4 describe blocks:

**1. `GET /api/v1/catalog/farmers` (4 tests)**
- Returns farmers with correct shape (`id`, `name`, `location`, pagination metadata)
- Cursor correctly advances: page 2 starts AFTER page 1 ends
- Non-numeric farmer ID → 400 Bad Request
- Last page returns `hasNextPage: false` and `nextCursor: null`

**2. `GET /api/v1/catalog/farmers/:id/products` (3 tests)**
- Returns products with CDN-prefixed image URLs
- `inStockOnly=true` excludes out-of-stock products
- Farmer with no products returns empty array (not error)

**3. `POST /api/v1/requests` — errors (3 tests)**
- Non-existent product → 404
- Product with zero stock → 400
- Quantity exceeding stock → 400

**4. `POST /api/v1/requests` — concurrency (1 test)**
```typescript
it('allows exactly 1 of 50 concurrent requests to succeed when only 1 unit is in stock', async () => {
  // Create 1 farmer, 1 product with stockQuantity=1, 50 distributors
  const statuses = await Promise.all(
    distributors.map((d) =>
      request(app.getHttpServer())
        .post('/api/v1/requests')
        .send({ distributorId: d.id, farmerIds: [farmer.id],
                items: [{ productId: product.id, quantity: 1 }] })
        .then((res) => res.status),
    ),
  );

  expect(statuses.filter((s) => s === 201)).toHaveLength(1);  // Exactly 1 success
  expect(statuses.filter((s) => s === 400)).toHaveLength(49); // 49 failures
}, 30_000);  // 30s timeout for concurrency
```

**5. Redis message delivered within 200ms (1 test)**
- A separate Redis subscriber listens for the notification
- Rejects if no message received within 200ms of placing the order
- Proves the Pub/Sub pipeline meets the latency SLA

**6. WebSocket end-to-end delivery (1 test)**
- A real Socket.IO client connects to `ws://localhost:3001/notifications`
- Registers as a farmer, then an order is placed
- Verifies the `new_request` event arrives with correct `farmerId`, `requestId`, `message`

Run E2E tests: `pnpm --filter @agriconnect/api-service test:e2e`

> **Prerequisite**: Docker must be running (`docker compose up -d`)

---

## 16. Build Orchestration with Turborepo

File: [`turbo.json`](turbo.json)

```json
{
  "tasks": {
    "build": {
      "dependsOn": ["^build"],    // Build dependencies FIRST
      "outputs": ["dist/**"]      // Cache the dist/ folder
    },
    "dev": {
      "dependsOn": ["^build"],    // Build deps, then start watchers
      "cache": false,             // Don't cache dev (it never ends)
      "persistent": true          // Runs forever (file watchers)
    },
    "test": {
      "dependsOn": ["^build"],    // Build first, then test
      "outputs": ["coverage/**"]
    },
    "test:e2e": {
      "dependsOn": ["^build"],
      "cache": false
    },
    "lint": {
      "outputs": []               // Linting produces no files
    }
  }
}
```

The `^build` notation means "build this workspace's dependencies before building it." So when you run `pnpm build`, Turbo resolves the graph:

```
pnpm build ──► turbo run build
                  │
                  ├── packages/tsconfig      (no deps → builds first)
                  ├── packages/common        (depends on tsconfig → builds second)
                  ├── packages/database      (depends on tsconfig → builds second)
                  ├── apps/api-service       (depends on common + database → builds third)
                  └── apps/notification-service (depends on common → builds third)
```

If nothing changed since the last build, Turbo **skips cached tasks** — the `dist/` folder output is cached and restored instantly.

---

## 17. Package Scripts Reference

### Root `package.json`

```bash
pnpm build       # Builds everything in dependency order (via turbo)
pnpm dev         # Starts all services in watch mode (restart on changes)
pnpm test        # Runs ALL unit tests across all workspaces
pnpm test:e2e    # Runs E2E tests across all workspaces
pnpm lint        # Lints all TypeScript files
```

### `@agriconnect/database`

```bash
pnpm --filter @agriconnect/database build       # Compile TypeScript
pnpm --filter @agriconnect/database dev         # Watch mode compilation
pnpm --filter @agriconnect/database db:migrate  # Apply pending migrations
pnpm --filter @agriconnect/database db:generate # Create migration from entity changes
pnpm --filter @agriconnect/database db:revert   # Revert the last migration
pnpm --filter @agriconnect/database db:seed     # Seed 10k farmers + 30k products
```

### `@agriconnect/api-service`

```bash
pnpm --filter @agriconnect/api-service build       # Compile (nest build)
pnpm --filter @agriconnect/api-service dev         # Start with watch mode
pnpm --filter @agriconnect/api-service test        # Run unit tests
pnpm --filter @agriconnect/api-service test:e2e    # Run E2E tests
pnpm --filter @agriconnect/api-service start       # Start production build
```

### `@agriconnect/notification-service`

```bash
pnpm --filter @agriconnect/notification-service build   # Compile
pnpm --filter @agriconnect/notification-service dev     # Start with watch mode
pnpm --filter @agriconnect/notification-service test    # Run unit tests
pnpm --filter @agriconnect/notification-service start   # Start production build
```

---

## 18. Tools Glossary

| Tool | What it is | Why we use it |
|---|---|---|
| **NestJS** | TypeScript framework for backend APIs | Module/Controller/Service pattern, dependency injection, decorators |
| **TypeORM** | Object-Relational Mapper (maps TS classes to DB tables) | Write database queries in TypeScript; migrations; supports `FOR UPDATE` |
| **PostgreSQL** | Relational database | Row-level locking (`SELECT FOR UPDATE`), partial indexes, JSON support |
| **Redis** | In-memory data store / message broker | Ultra-fast Pub/Sub messaging between services |
| **Socket.IO** | WebSocket library | Real-time bidirectional browser-server communication |
| **ioredis** | Node.js Redis client | Publish and subscribe to Redis channels with TypeScript types |
| **Docker Compose** | Container orchestration tool | One command (`docker compose up`) to start PostgreSQL + Redis |
| **pnpm** | Fast package manager | Manages monorepo workspaces; disk-efficient (hard links) |
| **Turborepo** | Monorepo build tool | Builds packages in dependency order; caches results for speed |
| **Jest** | JavaScript testing framework | Runs unit AND E2E tests; built-in mocking |
| **ts-jest** | TypeScript Jest transformer | Run TypeScript tests without pre-compiling |
| **supertest** | HTTP assertion library | Make fake HTTP requests in E2E tests without a real browser |
| **reflect-metadata** | Decorator metadata polyfill | Required by NestJS and TypeORM for decorator reflection |
| **ParseIntPipe** | NestJS validation pipe | Auto-converts route params to integers; returns 400 on invalid input |

---

## 19. Quick Start Reference

### Prerequisites

```bash
# Install these if you don't have them:
node --version     # Need >= 20
pnpm --version     # Install: npm install -g pnpm
docker --version   # Docker Desktop for macOS/Windows
```

### Full setup sequence

```bash
# 1. Start infrastructure (PostgreSQL + Redis)
docker compose up -d

# 2. Install dependencies
pnpm install

# (If prompted about build scripts, run: pnpm approve-builds)

# 3. Create database tables
pnpm --filter @agriconnect/database db:migrate

# 4. Seed 10k farmers + 30k products
pnpm --filter @agriconnect/database db:seed

# 5. Start both services in development mode
pnpm dev
```

### URLs after startup

| Service | URL |
|---|---|
| REST API | `http://localhost:3000/api/v1` |
| WebSocket (notifications) | `ws://localhost:3001/notifications` |

### Testing commands

```bash
# Run all unit tests (16 tests across 4 files)
pnpm test

# Run E2E tests (real DB + Redis required)
pnpm --filter @agriconnect/api-service test:e2e
```

### Quick API test

```bash
# Browse the first 5 farmers
curl http://localhost:3000/api/v1/catalog/farmers?limit=5

# See farmer #1's products
curl http://localhost:3000/api/v1/catalog/farmers/1/products

# Place an order (replace DISTRIBUTOR_UUID with one from the DB)
curl -X POST http://localhost:3000/api/v1/requests \
  -H "Content-Type: application/json" \
  -d '{"distributorId":"DISTRIBUTOR_UUID","farmerIds":[1],"items":[{"productId":1,"quantity":2}]}'
```

### Useful Docker commands

```bash
# View running containers
docker compose ps

# View logs
docker compose logs -f api-service
docker compose logs -f notification-service

# Stop everything (data preserved in volumes)
docker compose down

# Stop everything AND delete database data (fresh start)
docker compose down -v
```
