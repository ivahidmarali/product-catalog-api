import { NewProduct, Product, ProductChanges } from '../../Domain/Product/Product';
import { ProductListQuery } from '../../Domain/Product/ProductListQuery';

export interface ProductRepositoryInterface {
  /** @throws DuplicateSkuError */
  create(product: NewProduct): Promise<Product>;

  findById(id: string): Promise<Product | null>;

  /**
   * Returns null when the product does not exist.
   * @throws VersionConflictError when expectedVersion is given and does not match
   */
  update(id: string, changes: ProductChanges, expectedVersion?: number): Promise<Product | null>;

  /**
   * Returns false when the product does not exist.
   * @throws VersionConflictError when expectedVersion is given and does not match
   */
  delete(id: string, expectedVersion?: number): Promise<boolean>;

  /** Returns at most `query.limit` products in the requested order, starting after `query.after`. */
  list(query: ProductListQuery): Promise<Product[]>;
}
