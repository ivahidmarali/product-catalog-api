import { API_KEY, clearProducts, startTestApp, stopTestApp, TestContext } from './testApp';

type ProductBody = {
  id: string;
  sku: string;
  name: string;
  description: string;
  category: string;
  priceCents: number;
  version: number;
  createdAt: string;
  updatedAt: string;
};

let ctx: TestContext;
const auth = { 'x-api-key': API_KEY };

const createProduct = async (overrides: Partial<ProductBody> = {}): Promise<ProductBody> => {
  const response = await ctx.app.inject({
    method: 'POST',
    url: '/products',
    headers: auth,
    payload: { sku: `SKU-${Math.random()}`, name: 'Air Runner', category: 'shoes', priceCents: 12999, ...overrides },
  });
  expect(response.statusCode).toBe(201);

  return response.json<ProductBody>();
};

beforeAll(async () => {
  ctx = await startTestApp();
});

afterAll(async () => {
  await stopTestApp(ctx);
});

beforeEach(async () => {
  await clearProducts(ctx);
});

describe('GET /health', () => {
  it('reports ok when the database is reachable', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});

describe('authentication on writes', () => {
  it.each([
    ['no key', {}],
    ['a wrong key', { 'x-api-key': 'wrong' }],
  ])('rejects create with %s', async (_case, headers) => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/products',
      headers,
      payload: { sku: 'A', name: 'A', category: 'shoes', priceCents: 1 },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHORIZED');
  });

  it('rejects update and delete without a key and leaves the product alone', async () => {
    const product = await createProduct();

    const patch = await ctx.app.inject({ method: 'PATCH', url: `/products/${product.id}`, payload: { name: 'x' } });
    const del = await ctx.app.inject({ method: 'DELETE', url: `/products/${product.id}` });
    const get = await ctx.app.inject({ method: 'GET', url: `/products/${product.id}` });

    expect(patch.statusCode).toBe(401);
    expect(del.statusCode).toBe(401);
    expect(get.json()).toEqual(product);
  });

  it('checks the key before validating the body', async () => {
    const response = await ctx.app.inject({ method: 'POST', url: '/products', payload: { nonsense: true } });

    expect(response.statusCode).toBe(401);
  });

  it('lets anyone read without a key', async () => {
    const product = await createProduct();

    expect((await ctx.app.inject({ method: 'GET', url: `/products/${product.id}` })).statusCode).toBe(200);
    expect((await ctx.app.inject({ method: 'GET', url: '/products' })).statusCode).toBe(200);
  });
});

describe('POST /products', () => {
  it('creates a product and points to it', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/products',
      headers: auth,
      payload: { sku: 'SHOE-1', name: 'Air Runner', category: 'shoes', priceCents: 12999 },
    });
    const body = response.json<ProductBody>();

    expect(response.statusCode).toBe(201);
    expect(response.headers.location).toBe(`/products/${body.id}`);
    expect(response.headers.etag).toBe('"v1"');
    expect(body).toMatchObject({
      sku: 'SHOE-1',
      name: 'Air Runner',
      description: '',
      category: 'shoes',
      priceCents: 12999,
      version: 1,
    });
  });

  it('trims text fields', async () => {
    const product = await createProduct({ sku: '  SHOE-2 ', name: ' Runner ', category: ' shoes ' });

    expect(product).toMatchObject({ sku: 'SHOE-2', name: 'Runner', category: 'shoes' });
  });

  it('rejects a second product with the same SKU', async () => {
    await createProduct({ sku: 'SHOE-1' });

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/products',
      headers: auth,
      payload: { sku: 'SHOE-1', name: 'Other', category: 'shoes', priceCents: 1 },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('DUPLICATE_SKU');
  });

  it.each([
    ['missing fields', { name: 'No sku' }],
    ['a negative price', { sku: 'A', name: 'A', category: 'c', priceCents: -1 }],
    ['a decimal price', { sku: 'A', name: 'A', category: 'c', priceCents: 19.99 }],
    ['a price as text', { sku: 'A', name: 'A', category: 'c', priceCents: '100' }],
    ['an empty name', { sku: 'A', name: '   ', category: 'c', priceCents: 1 }],
    ['an unknown field', { sku: 'A', name: 'A', category: 'c', priceCents: 1, price: 1 }],
  ])('rejects %s', async (_case, payload) => {
    const response = await ctx.app.inject({ method: 'POST', url: '/products', headers: auth, payload });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects a body that is not JSON', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/products',
      headers: { ...auth, 'content-type': 'application/json' },
      payload: '{not json',
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('GET /products/:id', () => {
  it('returns the product with caching headers', async () => {
    const product = await createProduct();

    const response = await ctx.app.inject({ method: 'GET', url: `/products/${product.id}` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(product);
    expect(response.headers.etag).toBe('"v1"');
    expect(response.headers['cache-control']).toBe('public, max-age=60');
  });

  it('answers 304 when the client already has the latest version', async () => {
    const product = await createProduct();

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/products/${product.id}`,
      headers: { 'if-none-match': '"v1"' },
    });

    expect(response.statusCode).toBe(304);
    expect(response.body).toBe('');
  });

  it.each([['W/"v1"'], ['"v7", "v1"'], ['*']])('answers 304 for If-None-Match %s', async (header) => {
    const product = await createProduct();

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/products/${product.id}`,
      headers: { 'if-none-match': header },
    });

    expect(response.statusCode).toBe(304);
  });

  it('returns the body when If-None-Match is an older version', async () => {
    const product = await createProduct();

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/products/${product.id}`,
      headers: { 'if-none-match': '"v0"' },
    });

    expect(response.statusCode).toBe(200);
  });

  it('returns 404 for an unknown id', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/products/0b6c3f9e-6d0a-4d5e-9a57-2f1f0c4d9e11' });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('PRODUCT_NOT_FOUND');
  });

  it('returns 400 for an id that is not a uuid', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/products/123' });

    expect(response.statusCode).toBe(400);
  });
});

describe('PATCH /products/:id', () => {
  it('changes only the given fields and bumps the version', async () => {
    const product = await createProduct();

    const response = await ctx.app.inject({
      method: 'PATCH',
      url: `/products/${product.id}`,
      headers: auth,
      payload: { priceCents: 9999 },
    });
    const body = response.json<ProductBody>();

    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"v2"');
    expect(body).toMatchObject({ ...product, priceCents: 9999, version: 2, updatedAt: expect.any(String) });
    expect(new Date(body.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(product.updatedAt).getTime());
  });

  it('applies the update when If-Match has the current version', async () => {
    const product = await createProduct();

    const response = await ctx.app.inject({
      method: 'PATCH',
      url: `/products/${product.id}`,
      headers: { ...auth, 'if-match': '"v1"' },
      payload: { name: 'New name' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().name).toBe('New name');
  });

  it('refuses the update when If-Match is stale, so a concurrent change is not overwritten', async () => {
    const product = await createProduct();
    await ctx.app.inject({
      method: 'PATCH',
      url: `/products/${product.id}`,
      headers: auth,
      payload: { name: 'First' },
    });

    const response = await ctx.app.inject({
      method: 'PATCH',
      url: `/products/${product.id}`,
      headers: { ...auth, 'if-match': '"v1"' },
      payload: { name: 'Second' },
    });
    const current = await ctx.app.inject({ method: 'GET', url: `/products/${product.id}` });

    expect(response.statusCode).toBe(412);
    expect(response.json().error.code).toBe('VERSION_CONFLICT');
    expect(current.json().name).toBe('First');
  });

  it('refuses an If-Match header that is not one of our ETags', async () => {
    const product = await createProduct();

    const response = await ctx.app.inject({
      method: 'PATCH',
      url: `/products/${product.id}`,
      headers: { ...auth, 'if-match': 'garbage' },
      payload: { name: 'x' },
    });

    expect(response.statusCode).toBe(412);
    expect(response.json().error.code).toBe('PRECONDITION_FAILED');
  });

  it('accepts a weak If-Match ETag', async () => {
    const product = await createProduct();

    const response = await ctx.app.inject({
      method: 'PATCH',
      url: `/products/${product.id}`,
      headers: { ...auth, 'if-match': 'W/"v1"' },
      payload: { name: 'x' },
    });

    expect(response.statusCode).toBe(200);
  });

  it('rejects an empty update', async () => {
    const product = await createProduct();

    const response = await ctx.app.inject({
      method: 'PATCH',
      url: `/products/${product.id}`,
      headers: auth,
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects changing the SKU to one that is taken', async () => {
    await createProduct({ sku: 'TAKEN' });
    const product = await createProduct({ sku: 'MINE' });

    const response = await ctx.app.inject({
      method: 'PATCH',
      url: `/products/${product.id}`,
      headers: auth,
      payload: { sku: 'TAKEN' },
    });

    expect(response.statusCode).toBe(409);
  });

  it('returns 404 for an unknown product', async () => {
    const response = await ctx.app.inject({
      method: 'PATCH',
      url: '/products/0b6c3f9e-6d0a-4d5e-9a57-2f1f0c4d9e11',
      headers: auth,
      payload: { name: 'x' },
    });

    expect(response.statusCode).toBe(404);
  });

  it('returns 404, not 412, for an unknown product even with If-Match', async () => {
    const response = await ctx.app.inject({
      method: 'PATCH',
      url: '/products/0b6c3f9e-6d0a-4d5e-9a57-2f1f0c4d9e11',
      headers: { ...auth, 'if-match': '"v1"' },
      payload: { name: 'x' },
    });

    expect(response.statusCode).toBe(404);
  });
});

describe('DELETE /products/:id', () => {
  it('deletes the product', async () => {
    const product = await createProduct();

    const response = await ctx.app.inject({ method: 'DELETE', url: `/products/${product.id}`, headers: auth });
    const get = await ctx.app.inject({ method: 'GET', url: `/products/${product.id}` });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    expect(get.statusCode).toBe(404);
  });

  it('returns 404 the second time', async () => {
    const product = await createProduct();
    await ctx.app.inject({ method: 'DELETE', url: `/products/${product.id}`, headers: auth });

    const response = await ctx.app.inject({ method: 'DELETE', url: `/products/${product.id}`, headers: auth });

    expect(response.statusCode).toBe(404);
  });

  it('refuses to delete when If-Match is stale', async () => {
    const product = await createProduct();
    await ctx.app.inject({ method: 'PATCH', url: `/products/${product.id}`, headers: auth, payload: { name: 'x' } });

    const response = await ctx.app.inject({
      method: 'DELETE',
      url: `/products/${product.id}`,
      headers: { ...auth, 'if-match': '"v1"' },
    });

    expect(response.statusCode).toBe(412);
  });
});
