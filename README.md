# Product Catalog API

REST API to create, read, update, delete and list products. Lists can be filtered by category and price range, with pagination.

## Run

```bash
docker compose up --build
```

- API: http://localhost:3000
- Swagger: http://localhost:3000/docs (click **Authorize**, key: `local-dev-key-change-me`)

Load 300k fake products (about 6 seconds):

```bash
cp .env.example .env && npm ci && npm run seed
```

## Test

```bash
docker compose up -d db
npm test
```

77 tests. Integration tests run against a real Postgres.

## API

| Method   | Path             | Notes                                                                      |
| -------- | ---------------- | -------------------------------------------------------------------------- |
| `POST`   | `/products`      | Needs `x-api-key`. `409` if the SKU exists.                                |
| `GET`    | `/products`      | `category`, `minPriceCents`, `maxPriceCents`, `sort`, `limit`, `cursor`    |
| `GET`    | `/products/{id}` | Returns an `ETag`. Send `If-None-Match` to get `304`.                      |
| `PATCH`  | `/products/{id}` | Needs `x-api-key`. Optional `If-Match`, `412` if someone changed it first. |
| `DELETE` | `/products/{id}` | Needs `x-api-key`. Optional `If-Match`.                                    |

`sort` is `newest` (default), `price_asc` or `price_desc`. To get the next page, send back `nextCursor` as `cursor` with the same filters.

Prices are in cents (`12999` = EUR 129.99).

## Design choices

**PostgreSQL.** Filtering by a few fields and sorting is what a relational DB does well. A few hundred thousand rows fits in memory. DynamoDB would need a new index or a scan for every new filter.

**One index per sort order.** `(category, price_cents, id)`, `(price_cents, id)`, `(category, created_at, id)`, `(created_at, id)`. The main list queries read only the rows they return. One gap: newest first inside a narrow price range has no matching index (7 ms). I'd add one if real traffic needs it.

**Cursor pagination, not OFFSET.** Measured on 300k products:

| Query                            | Time   |
| -------------------------------- | ------ |
| Category + price range, any page | 0.2 ms |
| Deep page with cursor            | 0.1 ms |
| Same deep page with `OFFSET`     | 100 ms |

`id` breaks ties, so no product is skipped or shown twice. The cost: no page numbers and no total count.

**HTTP caching for the read load.** `Cache-Control` (60s for a product, 30s for lists) and `ETag`. A browser or CDN can answer most reads. A price change can take up to a minute to show. I skipped Redis because Postgres already answers in under a millisecond.

**No lost updates.** Each product has a `version`. `If-Match` makes the update fail with `412` if the version moved on.

**Writes need an API key.** Reads are public. In production this would be OAuth/JWT with an editor role.

## Code layout

```
src/Domain/          product, cursor, errors (no framework code)
src/Application/     ProductService + repository interface
src/Infrastructure/  Postgres repository, HTTP routes, validation
migrations/          plain SQL
```

## Next steps

- Free-text search (Postgres full-text first)
- Categories as their own table with a hierarchy
- Publish an event on every change, so search and other services stay in sync
- Metrics, tracing and rate limiting
