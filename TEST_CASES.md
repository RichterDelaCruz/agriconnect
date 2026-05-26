# Test Cases

> **Runner:** Jest 29 via `@nestjs/testing`  
> **Total:** ~23 tests across 4 spec files + 2 E2E scenarios

---

## `api-service` — CatalogService

**File:** `apps/api-service/src/catalog/catalog.service.spec.ts`

### `getFarmers` — 7 tests

| # | Test | What It Verifies |
|---|------|------------------|
| 1 | returns paginated farmers with `hasNextPage=false` when results ≤ limit | Normal pagination, 5 farmers, limit 20 |
| 2 | returns `hasNextPage=true` and `nextCursor` when extra row present | Detects next page, returns cursor |
| 3 | returns empty array with `hasNextPage=false` for empty dataset | No farmers at all |
| 4 | caps limit at `MAX_LIMIT` (100) | Hard upper bound enforced |
| 5 | prefixes `imageUrl` with CDN base | CDN URL mapping works |
| 6 | leaves null `imageUrl` as null (no CDN prefix) | Null-safe image handling |
| 7 | applies cursor filter when cursor is provided | Keyset pagination `WHERE id > :cursor` |

### `getProductsByFarmer` — 1+ test

| # | Test | What It Verifies |
|---|------|------------------|
| 8 | returns products for a specific farmer | Filters by `farmerId` |
| 9 | (applies cursor correctly when provided) | Cursor pagination on products |

---

## `api-service` — RequestsService

**File:** `apps/api-service/src/requests/requests.service.spec.ts`

### `createRequests — transaction rollback on failure` — 2 tests

| # | Test | What It Verifies |
|---|------|------------------|
| 10 | rolls back when a product is not found | Invalid `productId` → `NotFoundException` |
| 11 | rolls back when stock is insufficient | Quantity exceeds stock → `BadRequestException` |

### `createRequests — happy path` — 2 tests

| # | Test | What It Verifies |
|---|------|------------------|
| 12 | commits and publishes Redis notification on success | Saves request + publishes to `farmer_notifications` |
| 13 | does not throw if Redis publish fails after commit | Redis down → request still saved gracefully |

---

## `notification-service` — NotificationGateway

**File:** `apps/notification-service/src/gateway/notification.gateway.spec.ts`

### `handleRegister` — 2 tests

| # | Test | What It Verifies |
|---|------|------------------|
| 14 | registers a farmer and maps their `farmerId` to the socket id | `farmerSocketMap` stores mapping |
| 15 | returns a `"registered"` acknowledgement | Returns `{ event: 'registered', data: ... }` |

### `handleDisconnect` — 1 test

| # | Test | What It Verifies |
|---|------|------------------|
| 16 | removes the farmer mapping so future notifications are skipped | Cleanup on disconnect |

### `notifyFarmer` — 3 tests

| # | Test | What It Verifies |
|---|------|------------------|
| 17 | emits `"new_request"` with the full payload to the correct socket | Routes to the right socket ID |
| 18 | does nothing when the farmer is not registered on this instance | No-op for unknown farmer (horizontal scaling) |
| 19 | routes to the correct socket when multiple farmers are registered | Correct routing among multiple connections |

---

## `notification-service` — RedisSubscriberService

**File:** `apps/notification-service/src/gateway/redis-subscriber.service.spec.ts`

| # | Test | What It Verifies |
|---|------|------------------|
| 20 | subscribes to the `farmer_notifications` channel on init | Subscribes during `onModuleInit()` |
| 21 | forwards a valid message to `NotificationGateway.notifyFarmer` | Valid JSON → parsed and forwarded |
| 22 | does not throw and does not call `notifyFarmer` for malformed JSON | Garbage JSON silently ignored |
| 23 | disconnects Redis on module destroy | Clean disconnect on `onModuleDestroy()` |

---

## E2E Tests (integration)

**File:** `apps/api-service/test/app.e2e-spec.ts`

| # | Test | What It Verifies |
|---|------|------------------|
| E1 | allows exactly 1 of 50 concurrent requests to succeed when only 1 unit is in stock | Row-level locking (`FOR UPDATE`) |
| E2 | delivers a farmer notification within 200ms of request creation | Redis Pub/Sub → WebSocket latency SLA |

---

## Running Tests

```bash
# All tests
pnpm test

# API service only
pnpm --filter @agriconnect/api-service test

# Notification service only
pnpm --filter @agriconnect/notification-service test

# E2E tests (requires PostgreSQL + Redis running)
pnpm --filter @agriconnect/api-service test:e2e
```
