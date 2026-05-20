# AgriConnect — Backend

A platform that allows distributors to browse thousands of farmers, view products, and send requests in real time. Built as a NestJS monorepo with concurrent request handling, cursor-based pagination, and a Redis Pub/Sub notification gateway.

---

## Architecture

```
apps/
  api-service/          REST API — catalog browsing & request routing (port 3000)
  notification-service/ WebSocket gateway — real-time farmer notifications (port 3001)
packages/
  common/               Shared DTOs, interfaces, enums
  database/             TypeORM entities, migrations, seed scripts, DataSource
  tsconfig/             Shared TypeScript base configurations
```

**Stack**
- **NestJS v10** — framework for both services
- **PostgreSQL 16** — primary database (TypeORM v0.3)
- **Redis 7** — Pub/Sub bridge between services
- **Socket.IO** — WebSocket transport for real-time notifications
- **Turborepo + pnpm** — monorepo build orchestration

---

## Prerequisites

- [Node.js](https://nodejs.org/) >= 20
- [pnpm](https://pnpm.io/) >= 9 — `npm install -g pnpm`
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (for PostgreSQL and Redis)

---

## Setup

### 1. Install dependencies

```bash
pnpm install
```

> pnpm 11+ requires approving build scripts on first install. If prompted, run `pnpm approve-builds` and select `@nestjs/core`.

### 2. Start infrastructure

```bash
docker compose up -d
```

This starts PostgreSQL on port **5432** and Redis on port **6379**.

### 3. Run database migrations

```bash
pnpm --filter @agriconnect/database db:migrate
```

Creates all tables and indexes: `farmers`, `products`, `distributors`, `requests`, `request_items`.

### 4. Seed the database

```bash
pnpm --filter @agriconnect/database db:seed
```

Inserts **10,000 farmers** and **30,000 products** in batches of 500.

### 5. Start development servers

```bash
pnpm dev
```

Turborepo builds shared packages first, then starts all watchers concurrently:

| Service | URL |
|---|---|
| api-service (REST) | http://localhost:3000 |
| notification-service (WebSocket) | ws://localhost:3001/notifications |

---

## API Reference

### Catalog

```
GET /api/v1/catalog/farmers
```

| Query param | Type | Default | Description |
|---|---|---|---|
| `cursor` | number | 0 | ID of the last farmer seen (for pagination) |
| `limit` | number | 20 | Results per page (max 100) |

**Response**
```json
{
  "data": [{ "id": 1, "name": "...", "location": "...", "profileImageUrl": "..." }],
  "nextCursor": 50,
  "hasMore": true
}
```

---

```
GET /api/v1/catalog/farmers/:farmerId/products
```

| Query param | Type | Default | Description |
|---|---|---|---|
| `cursor` | number | 0 | Pagination cursor |
| `limit` | number | 20 | Results per page (max 100) |
| `inStockOnly` | boolean | false | Filter to products with stock > 0 |

---

### Requests

```
POST /api/v1/requests
Content-Type: application/json
```

```json
{
  "farmerId": 1,
  "distributorId": 1,
  "items": [
    { "productId": 1, "quantity": 2 }
  ]
}
```

Opens a database transaction with **row-level locking** (`SELECT FOR UPDATE`) to prevent race conditions. On success, publishes a notification to Redis which the notification-service delivers to the farmer's WebSocket connection.

---

## Real-Time Notifications

Connect to the notification service using Socket.IO:

```js
// In a browser console (load socket.io-client first) or Node.js script
const socket = io('http://localhost:3001/notifications');

// Register as a farmer to receive notifications
socket.emit('register', { farmerId: 1 });

socket.on('notification', (data) => {
  console.log(data);
  // { farmerId: 1, requestId: '...', message: 'You have a new request' }
});
```

Then submit a request via `POST /api/v1/requests` — the notification appears on the socket in real time.

---

## Testing

### Unit tests

```bash
pnpm test
```

16 tests across two suites:
- **catalog.service** — cursor pagination, CDN URL rewriting, in-stock filtering, limit cap
- **requests.service** — transaction rollback on not-found / insufficient stock, Redis failure resilience
- **redis-subscriber.service** — subscribe lifecycle, message forwarding, malformed JSON guard

### E2E tests

Requires `pnpm dev` to be running in a separate terminal.

```bash
pnpm --filter @agriconnect/api-service test:e2e
```

Covers:
- **Concurrency**: 50 simultaneous requests against 1 unit of stock — exactly 1 succeeds
- **WebSocket SLA**: notification delivered within 200 ms of request commit

---

## Database

### Migrations

```bash
# Apply all pending migrations
pnpm --filter @agriconnect/database db:migrate

# Revert the last migration
pnpm --filter @agriconnect/database db:revert

# Generate a new migration from entity changes
pnpm --filter @agriconnect/database db:generate
```

### Indexing strategy

| Index | Column(s) | Purpose |
|---|---|---|
| `idx_products_farmer_id` | `product.farmerId` | Farmer product listing |
| `idx_requests_farmer_id` | `request.farmerId` | Farmer request history |
| `idx_requests_distributor_id` | `request.distributorId` | Distributor request history |
| `idx_active_products` *(partial)* | `product.id WHERE stockQuantity > 0` | In-stock catalog filter |

---

## Environment Variables

Both apps read from environment variables. Defaults point to the Docker Compose services:

| Variable | Default | Description |
|---|---|---|
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_USER` | `postgres` | Database user |
| `DB_PASS` | `postgres` | Database password |
| `DB_NAME` | `agriconnect` | Database name |
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |

To override, create a `.env` file in the relevant app directory (already git-ignored).

---

## Horizontal Scaling

Every `notification-service` instance subscribes to the Redis `farmer_notifications` channel independently. When a notification is published, the instance holding the target farmer's socket connection delivers it — others silently no-op. No sticky sessions or shared socket state required.
