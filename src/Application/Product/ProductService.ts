import { ProductNotFoundError } from '../../Domain/Errors/ProductNotFoundError';
import { NewProduct, Product, ProductChanges } from '../../Domain/Product/Product';
import { decodeCursor, encodeCursor } from '../../Domain/Product/ProductCursorCodec';
import { ProductFilter, ProductSort } from '../../Domain/Product/ProductListQuery';
import { ProductRepositoryInterface } from './ProductRepositoryInterface';

export type ListProductsInput = {
  filter: ProductFilter;
  sort: ProductSort;
  limit: number;
  cursor?: string;
};

export type ProductPage = {
  items: Product[];
  nextCursor: string | null;
};

export class ProductService {
  constructor(private readonly repository: ProductRepositoryInterface) {}

  async create(product: NewProduct): Promise<Product> {
    return this.repository.create(product);
  }

  async get(id: string): Promise<Product> {
    const product = await this.repository.findById(id);
    if (!product) {
      throw new ProductNotFoundError(id);
    }

    return product;
  }

  async update(id: string, changes: ProductChanges, expectedVersion?: number): Promise<Product> {
    const product = await this.repository.update(id, changes, expectedVersion);
    if (!product) {
      throw new ProductNotFoundError(id);
    }

    return product;
  }

  async delete(id: string, expectedVersion?: number): Promise<void> {
    const deleted = await this.repository.delete(id, expectedVersion);
    if (!deleted) {
      throw new ProductNotFoundError(id);
    }
  }

  async list({ filter, sort, limit, cursor }: ListProductsInput): Promise<ProductPage> {
    const after = cursor ? decodeCursor(cursor, sort) : undefined;

    // Ask for one extra row. If it comes back, there is a next page.
    const rows = await this.repository.list({ filter, sort, limit: limit + 1, after });
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    const nextCursor = rows.length > limit && last ? encodeCursor(cursorFor(last, sort)) : null;

    return { items, nextCursor };
  }
}

const cursorFor = (product: Product, sort: ProductSort): { sort: ProductSort; value: string; id: string } => ({
  sort,
  value: sort === 'newest' ? product.createdAt.toISOString() : String(product.priceCents),
  id: product.id,
});
