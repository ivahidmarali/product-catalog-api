export type Product = {
  id: string;
  sku: string;
  name: string;
  description: string;
  category: string;
  /** Price in euro cents. Integers avoid floating point rounding on money. */
  priceCents: number;
  /** Goes up by one on every update. Used for ETags and optimistic locking. */
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

export type NewProduct = Pick<Product, 'sku' | 'name' | 'description' | 'category' | 'priceCents'>;

export type ProductChanges = Partial<NewProduct>;
