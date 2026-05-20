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
export {};
//# sourceMappingURL=app.e2e-spec.d.ts.map