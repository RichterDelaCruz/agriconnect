# AgriConnect — How It Works: A Plain-English Tutorial

This document explains the entire codebase from the ground up. No prior knowledge of any of the tools used is assumed.

---

## Table of Contents

1. [What does AgriConnect actually do?](#1-what-does-agriconnect-actually-do)
2. [The big picture — how all the pieces fit together](#2-the-big-picture)
3. [The folder structure explained](#3-the-folder-structure)
4. [The database — what gets stored and how](#4-the-database)
5. [The API service — answering HTTP requests](#5-the-api-service)
6. [The notification service — real-time alerts](#6-the-notification-service)
7. [Shared packages — code used by both services](#7-shared-packages)
8. [How a real request flows end-to-end](#8-end-to-end-flow-walkthrough)
9. [The concurrency trick — two buyers, one item](#9-the-concurrency-trick)
10. [Tests — how we know it works](#10-tests)
11. [The tools and why we use them](#11-tools-glossary)

---

## 1. What does AgriConnect actually do?

AgriConnect is a marketplace backend. It has two kinds of users:

- **Farmers** — they list products they want to sell (maize, wheat, etc.)
- **Distributors** — companies that browse farmers and buy products

The system has three main jobs:

| Job | How it works |
|---|---|
| Let distributors browse 10,000+ farmers and their products | Paginated REST API |
| Let multiple distributors buy the same product at the same time without double-selling | Row-level database locking |
| Instantly notify the farmer when a sale is made | WebSocket + Redis Pub/Sub |

---

## 2. The Big Picture

```
                          ┌─────────────────┐
  Distributor's app  ───► │   API Service   │ :3000
  (curl / frontend)       │   (NestJS REST) │
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
  (WebSocket)            │   (NestJS Socket.IO) │
                          └─────────────────────┘
```

**In plain English:**

1. A distributor calls the API to place an order.
2. The API saves the order to PostgreSQL and deducts stock.
3. The API sends a tiny message to Redis saying "farmer 42 just got an order".
4. The Notification Service, which is always listening to Redis, picks that message up and pushes it to the farmer's browser over WebSocket instantly.

The two services never talk to each other directly — Redis is the messenger between them. This is called **Pub/Sub** (publish / subscribe).

---

## 3. The Folder Structure

```
agriconnect/
├── apps/
│   ├── api-service/          ← The REST API (HTTP, port 3000)
│   └── notification-service/ ← The WebSocket server (port 3001)
├── packages/
│   ├── common/               ← Shared TypeScript types used by both apps
│   ├── database/             ← Database entities, migrations, seed data
│   └── tsconfig/             ← Shared TypeScript compiler settings
├── docker-compose.yml        ← Starts PostgreSQL and Redis locally
├── turbo.json                ← Build orchestration (what to build first)
└── package.json              ← Root config, lists all workspaces
```

### Why split it this way?

This is called a **monorepo** — one git repository containing multiple projects. The benefit is that `packages/database/` can be shared by both `api-service` and `notification-service` without duplicating code.

**Turborepo** (`turbo`) is the tool that manages building these in the right order — e.g., it compiles `packages/common` before trying to start `apps/api-service`, because the API imports types from common.

**pnpm** is the package manager (like npm or yarn, but faster and smarter about sharing packages between workspaces).

---

## 4. The Database

File: `packages/database/`

### The tables (entities)

TypeORM is the tool that maps TypeScript classes to database tables. Each class is called an **entity**.

#### `farmer` table
```
id          (integer, auto-increment)  ← the farmer's unique ID
name        (text)
location    (text)
imageUrl    (text, optional)           ← stored as "farmers/farmer-1.jpg"
```
Note: `imageUrl` stores only a *relative path*. When the API returns it to the caller, it prepends the CDN base URL (`https://cdn.agriconnect.com/media/`) to build the full URL. This prevents the URL from being hard-coded in the database.

#### `product` table
```
id              (integer, auto-increment)
farmerId        (integer)   ← foreign key → farmer.id
name            (text)
price           (decimal)
stockQuantity   (integer)   ← how many units are available
imageUrl        (text, optional)
```

#### `distributor` table
```
id    (UUID)
name  (text)
email (text, unique)
```

#### `request` table — a sale order
```
id             (UUID)
distributorId  (UUID)    ← who is buying
farmerId       (integer) ← from which farmer
status         (enum)    ← PENDING / CONFIRMED / REJECTED
createdAt      (timestamp)
```

#### `request_item` table — individual line items in an order
```
id         (UUID)
requestId  (UUID)
productId  (integer)
quantity   (integer)
```

### Migrations

A **migration** is a script that changes the database schema in a controlled, reversible way. Instead of manually running SQL, you write it in TypeScript and run it with a command. This means every developer gets the exact same database structure.

File: `packages/database/src/migrations/1716000000000-InitSchema.ts`

This one migration creates all the tables above, sets up foreign keys, and adds an index on `farmer.location` to make location-based searches faster.

### Seed data

File: `packages/database/src/seeds/index.ts`

This script inserts fake data for development and testing:
- 10,000 farmers (farmer-1 through farmer-10000)
- 30,000 products (3 per farmer)

Run it with: `pnpm --filter @agriconnect/database seed`

---

## 5. The API Service

Folder: `apps/api-service/src/`

This is a **NestJS** application. NestJS is a framework for building HTTP APIs in TypeScript. It uses a **module / controller / service** pattern:

- **Module** — groups related code together, tells NestJS what exists
- **Controller** — handles incoming HTTP requests, validates input
- **Service** — contains the actual business logic

All API routes are prefixed with `/api/v1`.

### Catalog module — browsing farmers and products

**Controller:** `catalog/catalog.controller.ts`  
**Service:** `catalog/catalog.service.ts`

#### `GET /api/v1/catalog/farmers`

Returns a paginated list of farmers. Uses **cursor-based pagination** — instead of page numbers, you pass the ID of the last item you saw.

```
GET /api/v1/catalog/farmers?limit=20
→ { data: [...20 farmers], nextCursor: 20, hasNextPage: true }

GET /api/v1/catalog/farmers?limit=20&cursor=20
→ { data: [...next 20 farmers], nextCursor: 40, hasNextPage: true }
```

Why cursor-based? With 10,000+ farmers, page numbers break when new records are inserted mid-browse. Cursors stay stable.

#### `GET /api/v1/catalog/farmers/:id/products`

Returns products for a specific farmer. Supports:
- `limit` — how many to return
- `cursor` — pagination cursor
- `inStockOnly=true` — filter to products with stock > 0

The service adds the CDN prefix to `imageUrl` here:
```typescript
// in catalog.service.ts
imageUrl: product.imageUrl
  ? `${CDN_BASE}/${product.imageUrl}`  // → "https://cdn.agriconnect.com/media/products/product-1.jpg"
  : null
```

### Requests module — placing orders

**Controller:** `requests/requests.controller.ts`  
**Service:** `requests/requests.service.ts`

#### `POST /api/v1/requests`

Body:
```json
{
  "distributorId": "uuid-of-distributor",
  "farmerIds": [42],
  "items": [{ "productId": 1001, "quantity": 2 }]
}
```

This is the most complex endpoint. See section 9 for how the concurrency safety works.

On success (201): returns the created request.  
On failure (400): "Insufficient stock" if someone else just bought the last unit.

After a successful order, the service publishes a Redis message:
```typescript
redis.publish('farmer_notifications', JSON.stringify({
  farmerId: "42",   // stringified integer
  requestId: "...",
  message: "New order received"
}))
```

### Redis module

`redis/redis.module.ts` sets up the **ioredis** client as a NestJS injectable. This is the connection the API service uses to *publish* messages. It is a separate connection from the one the notification service uses to *subscribe*.

---

## 6. The Notification Service

Folder: `apps/notification-service/src/`

This service has one job: listen for Redis messages and forward them to farmers over WebSocket.

### `redis-subscriber.service.ts`

On startup, this service subscribes to the `farmer_notifications` Redis channel:
```typescript
this.redis.subscribe('farmer_notifications')
this.redis.on('message', (channel, message) => {
  const payload = JSON.parse(message)
  // tell the gateway to send it to the right farmer
  this.gateway.notifyFarmer(payload.farmerId, payload)
})
```

### `notification.gateway.ts`

This is a **Socket.IO** gateway — it manages WebSocket connections. When a farmer's frontend connects, it joins a room named after their farmer ID:
```javascript
// On the farmer's browser:
socket.emit('join', { farmerId: '42' })
```

When `notifyFarmer('42', payload)` is called, the gateway emits the message to room `'42'` — only that farmer receives it.

---

## 7. Shared Packages

### `packages/common/`

Types and shapes shared between both apps so they never get out of sync.

- **`CreateRequestDto`** — the shape of a POST /requests body
- **`PaginationDto`** — the shape of a paginated response (`data`, `nextCursor`, `hasNextPage`)
- **`FarmerNotificationPayload`** — the shape of the Redis/WebSocket message

### `packages/database/`

Everything database-related:
- `AppDataSource` — the TypeORM connection configuration
- All entities (Farmer, Product, Distributor, Request, RequestItem)
- The migration file
- The seed script

Both the API service and the E2E tests import `AppDataSource` from here.

### `packages/tsconfig/`

- `base.json` — TypeScript settings shared by everything (strict mode, decorators enabled, etc.)
- `nestjs.json` — extends base, adds NestJS-specific overrides

---

## 8. End-to-End Flow Walkthrough

Here is exactly what happens when a distributor places an order:

```
1. Distributor sends:
   POST /api/v1/requests
   { distributorId, farmerIds: [42], items: [{ productId: 1001, quantity: 1 }] }

2. NestJS routes the request to RequestsController.create()

3. RequestsController calls RequestsService.createRequest()

4. RequestsService opens a database transaction:
   a. SELECT ... FROM product WHERE id = 1001 FOR UPDATE SKIP LOCKED
      → locks the product row so no other request can touch it simultaneously
   b. Checks if stockQuantity >= 1
      → if not, throws BadRequestException("Insufficient stock") → HTTP 400
   c. Deducts 1 from stockQuantity
   d. Creates a new Request row
   e. Creates a new RequestItem row
   f. Commits the transaction
   → if any step fails, everything rolls back (no half-saved data)

5. After commit, publishes to Redis:
   PUBLISH farmer_notifications '{"farmerId":"42","requestId":"...","message":"..."}'

6. Returns HTTP 201 with the new request object

7. Meanwhile, in the notification-service:
   a. RedisSubscriberService receives the message
   b. Calls notificationGateway.notifyFarmer('42', payload)
   c. Socket.IO emits to room '42'
   d. Farmer's browser receives the event in < 200ms
```

---

## 9. The Concurrency Trick

Imagine 50 distributors all click "Buy" at exactly the same millisecond, and there is only 1 unit of stock.

Without protection, all 50 could read `stockQuantity = 1`, all think "great, I can buy it", all deduct 1... and the stock ends up at `-49`. That's a race condition.

The fix is two PostgreSQL features used together:

**`FOR UPDATE`** — when you SELECT a row with this clause, PostgreSQL puts a write-lock on it. No other transaction can modify it until you're done.

**`SKIP LOCKED`** — instead of waiting for the lock (which would queue everyone up and still sell 50 items sequentially), rows that are already locked are simply skipped. The query returns nothing, and we immediately return "Insufficient stock".

```sql
SELECT * FROM product WHERE id = $1 FOR UPDATE SKIP LOCKED
```

Result: exactly 1 transaction gets the lock, deducts the stock, commits. The other 49 find the row locked, skip it, and get a 400 error. Stock never goes negative. This is verified by the E2E test that fires 50 simultaneous requests.

---

## 10. Tests

### Unit tests — testing logic in isolation

Location: files ending in `.spec.ts` next to each service.

These tests don't use a real database or Redis. Instead, they use **mocks** — fake objects that pretend to be the database/Redis and return pre-programmed responses. This makes tests fast and reliable.

Run them: `pnpm test`

| Test file | What it tests |
|---|---|
| `catalog.service.spec.ts` | Pagination logic, CDN prefix, cursor math |
| `requests.service.spec.ts` | Stock deduction, Redis publish, error on no stock |
| `redis-subscriber.service.spec.ts` | Redis message parsing, gateway forwarding |

### E2E tests — testing the whole system

Location: `apps/api-service/test/app.e2e-spec.ts`

These tests start the real NestJS app, connect to the real PostgreSQL and Redis (you need Docker running), and fire real HTTP requests. They test 7 scenarios:

| Test | What it proves |
|---|---|
| Farmer list returns integer IDs and pagination metadata | Catalog endpoint works |
| Cursor advances across pages correctly | Pagination is accurate |
| Non-numeric farmer ID returns 400 | Input validation works |
| Products have full CDN image URLs | CDN prefix logic works |
| `inStockOnly=true` filters out-of-stock products | Filter logic works |
| 50 concurrent buyers, 1 unit → exactly 1 succeeds | Concurrency safety works |
| Redis message arrives within 200ms | Real-time notification pipeline works |

Run them: `pnpm --filter @agriconnect/api-service test:e2e`

> Docker must be running: `docker compose up -d`

---

## 11. Tools Glossary

| Tool | What it is | Why we use it |
|---|---|---|
| **NestJS** | A TypeScript framework for building backend APIs | Structure, dependency injection, decorators |
| **TypeORM** | An "object-relational mapper" — maps TypeScript classes to DB tables | Write database queries in TypeScript, not raw SQL |
| **PostgreSQL** | A relational database | Stores all persistent data; supports row-level locking |
| **Redis** | An in-memory data store / message broker | Ultra-fast Pub/Sub messaging between services |
| **Socket.IO** | A WebSocket library | Real-time bidirectional communication with browsers |
| **ioredis** | A Node.js client for Redis | Publishes and subscribes to Redis channels |
| **Docker Compose** | Runs services in containers | One command to start PostgreSQL + Redis locally |
| **pnpm** | A fast package manager | Installs npm packages; manages the monorepo workspaces |
| **Turborepo** | A monorepo build tool | Builds packages in the right order, caches results |
| **ts-jest** | Runs TypeScript files in Jest | Lets you write tests in TypeScript directly |
| **supertest** | Makes HTTP requests in tests | Used in E2E tests to call the API without a real browser |
| **Jest** | A JavaScript testing framework | Runs unit and E2E test suites |

---

## Quick command reference

```bash
# Start the database and Redis
docker compose up -d

# Install dependencies
pnpm install

# Run the database migration (creates tables)
pnpm --filter @agriconnect/database migration:run

# Seed 10k farmers + 30k products
pnpm --filter @agriconnect/database seed

# Start both services in development mode
pnpm dev

# Run all unit tests
pnpm test

# Run E2E tests (Docker must be running)
pnpm --filter @agriconnect/api-service test:e2e
```

The API will be at `http://localhost:3000/api/v1`.  
The WebSocket server will be at `http://localhost:3001`.
