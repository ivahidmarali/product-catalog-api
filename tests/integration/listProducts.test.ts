import { clearProducts, startTestApp, stopTestApp, TestContext } from './testApp';

type ListBody = {
  data: { id: string; category: string; priceCents: number; createdAt: string }[];
  pagination: { limit: number; nextCursor: string | null };
};

let ctx: TestContext;

const list = async (query: string): Promise<{ statusCode: number; body: ListBody }> => {
  const response = await ctx.app.inject({ method: 'GET', url: `/products?${query}` });

  return { statusCode: response.statusCode, body: response.json<ListBody>() };
};

/** Follows nextCursor until the last page and returns every id in the order it was served. */
const walkAllPages = async (query: string): Promise<string[]> => {
  const ids: string[] = [];
  let cursor: string | null = null;
  do {
    const { statusCode, body } = await list(cursor ? `${query}&cursor=${encodeURIComponent(cursor)}` : query);
    expect(statusCode).toBe(200);
    ids.push(...body.data.map((product) => product.id));
    cursor = body.pagination.nextCursor;
  } while (cursor);

  return ids;
};

/**
 * Inserts rows straight into the table so we control created_at and can create ties:
 * 30 products over 3 categories, prices repeating every 5, and created_at repeating every 4.
 */
const seed = async (): Promise<void> => {
  await ctx.pool.query(`
    INSERT INTO products (sku, name, category, price_cents, created_at, updated_at)
    SELECT 'SKU-' || n,
           'Product ' || n,
           (ARRAY['shoes', 'shirts', 'bags'])[n % 3 + 1],
           (n % 5) * 1000,
           timestamptz '2026-01-01' + (n / 4) * interval '1 minute',
           now()
    FROM generate_series(1, 30) AS n
  `);
};

const expectedIds = async (where: string, orderBy: string): Promise<string[]> => {
  const { rows } = await ctx.pool.query<{ id: string }>(`SELECT id FROM products ${where} ORDER BY ${orderBy}`);

  return rows.map((row) => row.id);
};

beforeAll(async () => {
  ctx = await startTestApp();
  await clearProducts(ctx);
  await seed();
});

afterAll(async () => {
  await clearProducts(ctx);
  await stopTestApp(ctx);
});

describe('GET /products', () => {
  it('returns the first page, newest first, with defaults', async () => {
    const { statusCode, body } = await list('');

    expect(statusCode).toBe(200);
    expect(body.data).toHaveLength(20);
    expect(body.pagination.limit).toBe(20);
    expect(body.pagination.nextCursor).toEqual(expect.any(String));
    expect(body.data.map((p) => p.id)).toEqual((await expectedIds('', 'created_at DESC, id DESC')).slice(0, 20));
  });

  it.each([
    ['newest', 'created_at DESC, id DESC'],
    ['price_asc', 'price_cents ASC, id ASC'],
    ['price_desc', 'price_cents DESC, id DESC'],
  ])('walks every page sorted by %s without gaps or duplicates, even with ties', async (sort, orderBy) => {
    const ids = await walkAllPages(`sort=${sort}&limit=7`);

    expect(ids).toEqual(await expectedIds('', orderBy));
  });

  it('filters by category and price range across pages', async () => {
    const ids = await walkAllPages('category=shoes&minPriceCents=1000&maxPriceCents=3000&sort=price_asc&limit=2');

    const expected = await expectedIds(
      "WHERE category = 'shoes' AND price_cents BETWEEN 1000 AND 3000",
      'price_cents ASC, id ASC',
    );
    expect(expected.length).toBeGreaterThan(2);
    expect(ids).toEqual(expected);
  });

  it('treats the price bounds as inclusive', async () => {
    const { body } = await list('minPriceCents=2000&maxPriceCents=2000&limit=100');

    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.every((p) => p.priceCents === 2000)).toBe(true);
  });

  it('ignores empty filter values instead of treating them as 0', async () => {
    const { statusCode, body } = await list('minPriceCents=&maxPriceCents=&limit=100');

    expect(statusCode).toBe(200);
    expect(body.data).toHaveLength(30);
  });

  it('returns an empty page for a category with no products', async () => {
    const { statusCode, body } = await list('category=hats');

    expect(statusCode).toBe(200);
    expect(body).toEqual({ data: [], pagination: { limit: 20, nextCursor: null } });
  });

  it('returns no cursor when everything fits on one page', async () => {
    const { body } = await list('limit=100');

    expect(body.data).toHaveLength(30);
    expect(body.pagination.nextCursor).toBeNull();
  });

  it('sets a short cache lifetime on list responses', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/products' });

    expect(response.headers['cache-control']).toBe('public, max-age=30');
  });

  it.each([
    ['limit above 100', 'limit=101'],
    ['limit of 0', 'limit=0'],
    ['limit that is not a number', 'limit=abc'],
    ['negative price', 'minPriceCents=-1'],
    ['min above max', 'minPriceCents=5000&maxPriceCents=1000'],
    ['unknown sort', 'sort=name'],
    ['broken cursor', 'cursor=abc'],
    ['null character in category', 'category=a%00b'],
  ])('rejects %s with 400', async (_case, query) => {
    const { statusCode } = await list(query);

    expect(statusCode).toBe(400);
  });

  it('rejects a cursor from a different sort order', async () => {
    const { body } = await list('sort=price_asc&limit=5');

    const { statusCode } = await list(
      `sort=newest&limit=5&cursor=${encodeURIComponent(body.pagination.nextCursor ?? '')}`,
    );

    expect(statusCode).toBe(400);
  });
});
