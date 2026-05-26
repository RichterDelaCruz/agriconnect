# 🖥️ AgriConnect — CLI Demo Walkthrough

> Demonstrate all app features using **only terminal commands**.
> No code, no spec files — just curl, websocat, and raw JSON.

---

## 📋 Prerequisites

Before starting, make sure services are running:

```bash
# 1. Start infrastructure (PostgreSQL + Redis)
docker compose up -d

# 2. Run migrations
pnpm --filter @agriconnect/database db:migrate

# 3. Seed 10,000 farmers + 30,000 products
pnpm --filter @agriconnect/database db:seed

# 4. Start both services
pnpm dev

---

> **⚠️ UUID Requirement:** The `distributorId` field in requests must be a **valid UUID**
> because the `distributor.id` column in PostgreSQL is `uuid` type.
> Get valid distributor UUIDs from the database:
>
> ```bash
> docker exec -it agriconnect-postgres-1 psql -U postgres -d agriconnect \
>   -c "SELECT id, name FROM distributor;"
> ```
>
> You'll see output like:
> ```
> id                                   | name
> -------------------------------------+---------------------
>  c3f45a6d-1ee6-411d-98b5-a4dc7fe0c044 | Global Grains Co.
>  7efa9dec-1887-4d5d-9a43-28b03004ed4e | FreshDist Inc.
> ```
>
> Use one of these UUIDs in all requests below (replace `DISTRIBUTOR_UUID`).
```

---

## 1️⃣ Browse the Catalog (Paginated Farmers)

**Test:** Returns paginated farmers with CDN-prefixed images.

```bash
# Fetch first page (default 20 farmers)
curl -s http://localhost:3000/api/v1/catalog/farmers | jq
```

<details>
<summary>👉 Click to see output</summary>

```json
{
  "data": [
    {
      "id": 1,
      "name": "Farmer Maria",
      "location": "Nairobi",
      "imageUrl": "https://cdn.agriconnect.com/media/farmer_1.jpg",
      "createdAt": "2025-01-15T08:00:00.000Z"
    },
    {
      "id": 2,
      "name": "Farmer James",
      "location": "Kisumu",
      "imageUrl": "https://cdn.agriconnect.com/media/farmer_2.jpg",
      "createdAt": "2025-01-15T08:00:00.000Z"
    }
  ],
  "nextCursor": 21,
  "hasNextPage": true
}
```
</details>

### Pagination — next page

**Test:** `hasNextPage=true` with cursor when more results exist.

```bash
# Use the cursor from the previous response
curl -s "http://localhost:3000/api/v1/catalog/farmers?cursor=21&limit=5" | jq
```

<details>
<summary>👉 Click to see output</summary>

```json
{
  "data": [
    { "id": 22, "name": "Farmer Grace", "location": "Mombasa", "imageUrl": "https://cdn.agriconnect.com/media/farmer_22.jpg" },
    { "id": 23, "name": "Farmer Peter", "location": "Eldoret", "imageUrl": "https://cdn.agriconnect.com/media/farmer_23.jpg" },
    { "id": 24, "name": "Farmer Anne", "location": "Nakuru", "imageUrl": "https://cdn.agriconnect.com/media/farmer_24.jpg" },
    { "id": 25, "name": "Farmer John", "location": "Thika", "imageUrl": "https://cdn.agriconnect.com/media/farmer_25.jpg" },
    { "id": 26, "name": "Farmer Lucy", "location": "Nyeri", "imageUrl": "https://cdn.agriconnect.com/media/farmer_26.jpg" }
  ],
  "nextCursor": 27,
  "hasNextPage": true
}
```
</details>

### Last page — no more results

**Test:** Empty dataset with `hasNextPage=false`.

```bash
# Request beyond the last farmer
curl -s "http://localhost:3000/api/v1/catalog/farmers?cursor=10001" | jq
```

<details>
<summary>👉 Click to see output</summary>

```json
{
  "data": [],
  "nextCursor": null,
  "hasNextPage": false
}
```
</details>

### Limit is capped at 100

**Test:** Hard upper bound enforced.

```bash
# Ask for 999 — server caps at 100
curl -s "http://localhost:3000/api/v1/catalog/farmers?limit=999" | jq '.data | length'
```

```
100
```

### Null image stays null

**Test:** Farmers with no image get no CDN prefix.

```bash
# Find farmers with null imageUrl
curl -s "http://localhost:3000/api/v1/catalog/farmers?limit=50" | jq '[.data[] | select(.imageUrl == null) | {id, name}]'
```

```json
[
  { "id": 7, "name": "Farmer Kevin" },
  { "id": 14, "name": "Farmer Alice" }
]
```

---

## 2️⃣ Browse Products by Farmer

**Test:** Returns products for a specific farmer.

```bash
# Pick farmer ID 1
curl -s "http://localhost:3000/api/v1/catalog/farmers/1/products" | jq
```

<details>
<summary>👉 Click to see output</summary>

```json
{
  "data": [
    {
      "id": 1,
      "farmerId": 1,
      "name": "Organic Maize",
      "price": "25.00",
      "stockQuantity": 100,
      "imageUrl": "https://cdn.agriconnect.com/media/product_1.jpg"
    },
    {
      "id": 2,
      "farmerId": 1,
      "name": "Wheat Grain",
      "price": "40.00",
      "stockQuantity": 50,
      "imageUrl": null
    }
  ],
  "nextCursor": null,
  "hasNextPage": false
}
```
</details>

### Filter in-stock only

```bash
# Only show products with stockQuantity > 0
curl -s "http://localhost:3000/api/v1/catalog/farmers/1/products?inStockOnly=true" | jq
```

---

## 3️⃣ Create a Purchase Request

**Test:** Commits request and publishes Redis notification.

```bash
# Find a product with stock
PRODUCT_ID=1

curl -s -X POST http://localhost:3000/api/v1/requests \
  -H "Content-Type: application/json" \
  -d '{
    "distributorId": "c3f45a6d-1ee6-411d-98b5-a4dc7fe0c044",
    "farmerIds": [1],
    "items": [
      { "productId": 1, "quantity": 5 }
    ]
  }' | jq
```

<details>
<summary>👉 Click to see output</summary>

```json
[
  {
    "id": "c87528aa-ea9d-43cb-9498-720c6e405589",
    "distributorId": "c3f45a6d-1ee6-411d-98b5-a4dc7fe0c044",
    "farmerId": 1,
    "status": "PENDING",
    "createdAt": "2026-05-25T22:25:15.330Z",
    "items": [
      {
        "id": "a7cac12e-f57f-43c6-9f67-a2bc8418f33a",
        "productId": 1,
        "quantity": 3
      }
    ]
  }
]
```
</details>

### Verify stock was deducted

```bash
# Product 1 originally had 100, we bought 5 → should have 95
curl -s "http://localhost:3000/api/v1/catalog/farmers/1/products" | jq '.data[] | select(.id == 1) | {name, stockQuantity}'
```

```json
{
  "name": "Organic Maize",
  "stockQuantity": 95
}
```

### Product not found → rolls back

**Test:** Invalid `productId` triggers rollback.

```bash
curl -s -X POST http://localhost:3000/api/v1/requests \
  -H "Content-Type: application/json" \
  -d '{
    "distributorId": "c3f45a6d-1ee6-411d-98b5-a4dc7fe0c044",
    "farmerIds": [1],
    "items": [
      { "productId": 99999, "quantity": 1 }
    ]
  }' | jq
```

```json
{
  "error": "Not Found",
  "message": "One or more products not found.",
  "statusCode": 404
}
```

### Insufficient stock → rolls back

**Test:** Quantity exceeds stock triggers rollback.

```bash
# Product 1 now has 95 — try buying 200
curl -s -X POST http://localhost:3000/api/v1/requests \
  -H "Content-Type: application/json" \
  -d '{
    "distributorId": "c3f45a6d-1ee6-411d-98b5-a4dc7fe0c044",
    "farmerIds": [1],
    "items": [
      { "productId": 1, "quantity": 200 }
    ]
  }' | jq
```

```json
{
  "error": "Bad Request",
  "message": "Insufficient stock for product \"Organic Maize\". Requested: 200, Available: 95",
  "statusCode": 400
}
```

---

## 4️⃣ 🏆 The Concurrency Trick — 50 Buyers, 1 Item

**Test:** Row-level locking prevents overselling.

Set up a product with exactly **1 unit** in stock, then fire 50 simultaneous requests:

```bash
PRODUCT_ID=5  # pick a product with stockQuantity=1

# Launch 50 concurrent requests using xargs
seq 1 50 | xargs -P 50 -I {} curl -s -X POST http://localhost:3000/api/v1/requests \
  -H "Content-Type: application/json" \
  -d "{
    \"distributorId\": \"c3f45a6d-1ee6-411d-98b5-a4dc7fe0c044\",
    \"farmerIds\": [1],
    \"items\": [
      { \"productId\": $PRODUCT_ID, \"quantity\": 1 }
    ]
  }" -o /tmp/response_{}.json

# Count how many succeeded (status PENDING)
grep -l '"PENDING"' /tmp/response_*.json | wc -l
```

```
1    ← Only 1 succeeded! The rest got stock errors.
```

```bash
# Count how many failed (insufficient stock)
grep -l 'Insufficient stock' /tmp/response_*.json | wc -l
```

```
49   ← 49 were rejected.
```

### How it works

```
Request 1 ──► SELECT ... FOR UPDATE ──► stock=1, deduct ──► COMMIT ✅
Request 2 ──► waits for lock ──► stock=0, reject ──► ROLLBACK ❌
Request 3 ──► waits for lock ──► stock=0, reject ──► ROLLBACK ❌
...
```

The `FOR UPDATE` lock serializes the writes — only the first request sees stock=1, the other 49 see stock=0.

---

## 5️⃣ Real-Time WebSocket Notification

**Test:** Farmer gets notified within 200ms of a purchase.

### Open WebSocket connection (terminal 1)

Socket.IO uses its own protocol (not raw WebSockets), so you need the `socket.io-client` library:

```bash
# Install socket.io-client globally
npm install -g socket.io-client

# Start listening as farmer 1
NODE_PATH=$(npm root -g) node -e "
const { io } = require('socket.io-client');
const s = io('http://localhost:3001/notifications');
s.on('connect', () => { console.log('CONNECTED'); s.emit('register', { farmerId: '1' }); });
s.on('new_request', (d) => { console.log('*** NOTIFICATION ***'); console.log(JSON.stringify(d, null, 2)); });
s.on('connect_error', (e) => console.log('ERROR:', e.message));
"
```

Output:
```
CONNECTED
```

### Create a purchase (terminal 2)

```bash
curl -s -X POST http://localhost:3000/api/v1/requests \
  -H "Content-Type: application/json" \
  -d '{
    "distributorId": "c3f45a6d-1ee6-411d-98b5-a4dc7fe0c044",
    "farmerIds": [1],
    "items": [
      { "productId": 1, "quantity": 3 }
    ]
  }' | jq
```

### Watch notification arrive (terminal 1)

Within ~200ms, you'll see:

```
*** NOTIFICATION ***
{
  "farmerId": "1",
  "requestId": "9763edc8-d2c1-4c85-9992-cc02b723b4ad",
  "message": "You have received a new distributor request."
}
```

### Unregistered farmer gets nothing

**Test:** Notifications only go to connected farmers.

```bash
# Farmer 999 is not connected — no notification is sent
# (no output on any WebSocket client)
curl -s -X POST http://localhost:3000/api/v1/requests \
  -H "Content-Type: application/json" \
  -d '{
    "distributorId": "c3f45a6d-1ee6-411d-98b5-a4dc7fe0c044",
    "farmerIds": [999],
    "items": [
      { "productId": 2, "quantity": 1 }
    ]
  }' | jq
```

Silently succeeds on the API side, but no WebSocket message — the notification service sees farmer 999 isn't registered and moves on.

---

## 📊 Summary

| Feature | CLI Command | What it proves |
|---------|-------------|----------------|
| Browse farmers | `GET /api/v1/catalog/farmers` | Pagination, CDN prefix, null-safe images |
| Cursor pagination | `GET ...?cursor=21&limit=5` | Keyset pagination works |
| Max limit | `GET ...?limit=999` | Hard cap at 100 |
| Browse products | `GET .../farmers/1/products` | Filter by farmer |
| Create request | `POST /api/v1/requests` | Transaction commits + stock deducts |
| Invalid product | `POST ... { productId: 99999 }` | Transaction rolls back |
| Insufficient stock | `POST ... { quantity: 200 }` | Transaction rolls back |
| Concurrency (50x) | `xargs -P 50 curl ...` | Row-level locking (`FOR UPDATE`) |
| WebSocket notify | `node -e "const {io}=require('socket.io-client');..."` | Redis Pub/Sub → Socket.IO |
