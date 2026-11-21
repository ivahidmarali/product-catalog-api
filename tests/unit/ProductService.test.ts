import { ProductRepositoryInterface } from '../../src/Application/Product/ProductRepositoryInterface';
import { ProductService } from '../../src/Application/Product/ProductService';
import { ProductNotFoundError } from '../../src/Domain/Errors/ProductNotFoundError';
import { Product } from '../../src/Domain/Product/Product';
import { decodeCursor } from '../../src/Domain/Product/ProductCursorCodec';

const product = (n: number): Product => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  sku: `SKU-${n}`,
  name: `Product ${n}`,
  description: '',
  category: 'shoes',
  priceCents: n * 100,
  version: 1,
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, n)),
  updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, n)),
});

const repositoryReturning = (rows: Product[]): jest.Mocked<ProductRepositoryInterface> => ({
  create: jest.fn(),
  findById: jest.fn().mockResolvedValue(null),
  update: jest.fn().mockResolvedValue(null),
  delete: jest.fn().mockResolvedValue(false),
  list: jest.fn().mockResolvedValue(rows),
});

describe('ProductService.list', () => {
  it('asks the repository for one extra row to know if there is a next page', async () => {
    const repository = repositoryReturning([]);

    await new ProductService(repository).list({ filter: {}, sort: 'newest', limit: 2 });

    expect(repository.list).toHaveBeenCalledWith({ filter: {}, sort: 'newest', limit: 3, after: undefined });
  });

  it('returns a cursor pointing at the last item when there is a next page', async () => {
    const rows = [product(3), product(2), product(1)];

    const page = await new ProductService(repositoryReturning(rows)).list({ filter: {}, sort: 'newest', limit: 2 });

    expect(page.items).toEqual([product(3), product(2)]);
    expect(decodeCursor(page.nextCursor ?? '', 'newest')).toEqual({
      sort: 'newest',
      value: product(2).createdAt.toISOString(),
      id: product(2).id,
    });
  });

  it('uses the price as cursor value for price sorts', async () => {
    const page = await new ProductService(repositoryReturning([product(1), product(2)])).list({
      filter: {},
      sort: 'price_asc',
      limit: 1,
    });

    expect(decodeCursor(page.nextCursor ?? '', 'price_asc').value).toBe('100');
  });

  it('returns no cursor on the last page', async () => {
    const page = await new ProductService(repositoryReturning([product(1)])).list({
      filter: {},
      sort: 'newest',
      limit: 2,
    });

    expect(page.nextCursor).toBeNull();
  });
});

describe('ProductService not found handling', () => {
  const service = new ProductService(repositoryReturning([]));
  const id = product(1).id;

  it('throws on get', async () => {
    await expect(service.get(id)).rejects.toBeInstanceOf(ProductNotFoundError);
  });

  it('throws on update', async () => {
    await expect(service.update(id, { name: 'x' })).rejects.toBeInstanceOf(ProductNotFoundError);
  });

  it('throws on delete', async () => {
    await expect(service.delete(id)).rejects.toBeInstanceOf(ProductNotFoundError);
  });
});
