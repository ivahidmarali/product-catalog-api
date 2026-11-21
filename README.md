# Product Catalog API

A REST API for an e-commerce product catalog. Clients can create, read, update and delete products, and list them filtered by category and price range with pagination.

The brief assumed a few hundred thousand products and far more reads than writes. Most decisions below come from those two facts.

## Run it

You need Docker. Node 22 is only needed for the tests and the seed script.

```bash
docker compose up --build
```

- API: http://localhost:3000
- Swagger UI: http://localhost:3000/docs
- Health: http://localhost:3000/health

Migrations run when the container starts.

To load 300k fake products (takes about 6 seconds):

```bash
cp .env.example .env
npm ci
npm run seed            # or: npm run seed 1000
```

### Tests

```bash
docker compose up -d db   # integration tests use a separate catalog_test database
npm test
```

There are 64 tests. Unit tests cover the cursor and the service logic. Integration tests go through the real HTTP layer against Postgres, including walking every page in each sort order with tied prices and timestamps to prove nothing is skipped or repeated.

## Try it

Reads are public. Writes need the `x-api-key` header (the local key is `local-dev-key-change-me`, set in `docker-compose.yaml`). In Swagger, click **Authorize** and paste it.

```bash
KEY=local-dev-key-change-me

# Create
curl -i -X POST localhost:3000/products \
  -H "x-api-key: $KEY" -H 'content-type: application/json' \
  -d '{"sku":"SHOE-001","name":"Trail Runner","category":"shoes","priceCents":12999}'

# Get one
curl -i localhost:3000/products/<id>

# List shoes between EUR 50 and EUR 150, cheapest first
curl 'localhost:3000/products?category=shoes&minPriceCents=5000&maxPriceCents=15000&sort=price_asc&limit=20'

# Next page: pass nextCursor from the previous response, with the same filters and sort
curl 'localhost:3000/products?category=shoes&minPriceCents=5000&maxPriceCents=15000&sort=price_asc&limit=20&cursor=<nextCursor>'

# Update the price, only if nobody changed it since I read version 1
curl -i -X PATCH localhost:3000/products/<id> \
  -H "x-api-key: $KEY" -H 'if-match: "v1"' -H 'content-type: application/json' \
  -d '{"priceCents":9999}'

# Delete
curl -i -X DELETE localhost:3000/products/<id> -H "x-api-key: $KEY"
```

## API

| Method   | Path             | Notes                                                                                                                                                                               |
| -------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST`   | `/products`      | `201` with `Location` and `ETag`. `409` if the SKU exists.                                                                                                                          |
| `GET`    | `/products`      | Filters: `category`, `minPriceCents`, `maxPriceCents` (inclusive). `sort`: `newest` (default), `price_asc`, `price_desc`. `limit` 1 to 100, default 20. `cursor` for the next page. |
| `GET`    | `/products/{id}` | `ETag` and `Cache-Control`. Send `If-None-Match` to get a `304`.                                                                                                                    |
| `PATCH`  | `/products/{id}` | Partial update. Optional `If-Match` for optimistic locking, `412` when stale.                                                                                                       |
| `DELETE` | `/products/{id}` | `204`. Optional `If-Match`.                                                                                                                                                         |

Errors always look like `{ "error": { "code": "PRODUCT_NOT_FOUND", "message": "...", "details": [...] } }`, so clients can switch on `code`.

## Design decisions

### PostgreSQL

The read side is "filter by a few fields, sort, page through". That is what a relational database with composite indexes does well. A few hundred thousand rows is small for Postgres; the whole table and its indexes fit in memory.

I looked at DynamoDB, which is what I use most day to day. It works for one access pattern (a GSI on category with price as the sort key), but every new filter or sort needs another index or a scan. Here the access patterns are the main requirement and are likely to grow, so a relational model is the safer choice. If one lookup ever needs extreme scale, such as product by id on a big launch day, that can go to a cache or key-value store later without changing the main store.

### Indexes match the queries

Each list query is filter, then sort, then take the next page. There is one index per sort order, with and without the category filter, each ending with `id`:

```sql
(category, price_cents, id)   (price_cents, id)
(category, created_at, id)    (created_at, id)
```

Measured with `EXPLAIN ANALYZE` on 300k rows:

| Query                                               | Time    |
| --------------------------------------------------- | ------- |
| Category + price range, sorted by price, first page | 0.17 ms |
| Same, next page                                     | 0.10 ms |
| Newest first, deep into the list                    | 0.09 ms |
| Same depth with `OFFSET 250000` instead             | 100 ms  |

### Cursor pagination, not OFFSET

`OFFSET` makes Postgres read and throw away every row before the page, so deep pages get slower (100 ms above, and growing with the table). Pages also shift when products are added or removed between requests.

A keyset cursor stores the sort value and id of the last row, and the next query asks for rows after it, like `(price_cents, id) > (1999, '...')`. That goes straight to the right place in the index, so page 1 and page 10,000 cost the same. `id` breaks ties, so products with the same price are never skipped or repeated.

The cursor is opaque base64 JSON, and it remembers its sort order. A cursor from another sort or a tampered one returns `400`, never a database error.

The trade-off: no "jump to page 37" and no total count. A `COUNT(*)` with filters on every list call costs more than the page itself. If the UI needs counts, I'd add facet counts per category, cached or computed separately.

### Caching for a read-heavy load

- Single product: `Cache-Control: public, max-age=60` and an `ETag` based on the version. Browsers and a CDN can serve repeat reads, and `If-None-Match` revalidation returns a `304` with no body.
- Lists: `max-age=30`.

So a price change can take up to a minute to show everywhere. That is fine for a catalog. Checkout should always read the price from the source.

I left out an application cache like Redis. With these indexes Postgres answers in well under a millisecond, and a shared cache brings invalidation problems. The next steps for more read traffic would be a CDN in front, then read replicas.

### Concurrent updates

Every product has a `version` that goes up on each write. The `ETag` is `"v<version>"`. A client that sends it back in `If-Match` only updates if nobody else changed the product in between, otherwise it gets `412`. The check and the update happen in one `UPDATE ... WHERE version = $n`, so there is no race. `If-Match` is optional to keep simple clients simple.

### Money

Prices are integer cents (`priceCents`), never floats, so there are no rounding errors. I assumed one currency (EUR). Multiple currencies or markets would need a price per currency or market, which deserves its own table.

### Auth

Anyone can read; create, update and delete need the `x-api-key` header, compared in constant time. That is enough to show where the boundary sits. In production I'd use the company's identity provider (OAuth2 / JWT) with a catalog-editor role and keep the same route-level check.

### Code structure

Same layering I use at work, kept small:

```
src/
  Domain/           Product types, cursor encoding, domain errors. No framework code.
  Application/      ProductService and the repository interface it depends on.
  Infrastructure/
    Postgres/       Repository (plain SQL), pool, migration runner.
    Http/           Fastify routes, zod schemas, error mapping, API key check.
  Core/             Config, validated at startup.
migrations/         Plain SQL, applied in order, guarded by an advisory lock.
scripts/seed.ts     Generates fake products inside Postgres.
```

The service only knows the repository interface, so unit tests use a fake and Postgres stays in the infrastructure layer. I used plain SQL instead of an ORM because the queries are few and the exact SQL is what makes them fast.

Zod schemas validate input and also generate the OpenAPI spec, so the docs can't drift from the code.

## What I'd do next

- **Search.** Free-text search on name and description. Postgres full-text search is enough at this size. Elasticsearch or OpenSearch only if relevance tuning or facets become important.
- **More filter and sort combinations.** "Newest first within a narrow price range" has no matching index, so it takes about 7 ms instead of under 1 ms. Fine now; I'd add an index when real traffic shows the pattern.
- **Categories as their own table** with a hierarchy (`shoes > running`), instead of free text.
- **Soft delete or events.** If other systems such as search, feeds or orders need to know about changes, publish an event on every write (outbox pattern) instead of having them poll.
- **Observability.** Structured logs are in place. Next would be request metrics, tracing, and slow-query alerts.
- **Rate limiting** on the write endpoints.
