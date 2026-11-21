import { DatabaseError, Pool } from 'pg';
import { ProductRepositoryInterface } from '../../Application/Product/ProductRepositoryInterface';
import { DuplicateSkuError } from '../../Domain/Errors/DuplicateSkuError';
import { VersionConflictError } from '../../Domain/Errors/VersionConflictError';
import { NewProduct, Product, ProductChanges } from '../../Domain/Product/Product';
import { ProductListQuery, ProductSort } from '../../Domain/Product/ProductListQuery';

type ProductRow = {
  id: string;
  sku: string;
  name: string;
  description: string;
  category: string;
  price_cents: number;
  version: number;
  created_at: Date;
  updated_at: Date;
};

const COLUMNS = 'id, sku, name, description, category, price_cents, version, created_at, updated_at';

const UNIQUE_VIOLATION = '23505';

// Only these keys can become column names in an UPDATE, so user input never reaches the SQL text.
const UPDATABLE_COLUMNS: Record<keyof ProductChanges, string> = {
  sku: 'sku',
  name: 'name',
  description: 'description',
  category: 'category',
  priceCents: 'price_cents',
};

// For each sort: the ORDER BY, and the comparison that means "comes after the cursor".
// Row comparisons like (price_cents, id) > ($1, $2) can be answered straight from the composite indexes.
const SORTS: Record<ProductSort, { orderBy: string; after: string }> = {
  newest: {
    orderBy: 'created_at DESC, id DESC',
    after: '(created_at, id) < ($CURSOR_VALUE::timestamptz, $CURSOR_ID::uuid)',
  },
  price_asc: {
    orderBy: 'price_cents ASC, id ASC',
    after: '(price_cents, id) > ($CURSOR_VALUE::integer, $CURSOR_ID::uuid)',
  },
  price_desc: {
    orderBy: 'price_cents DESC, id DESC',
    after: '(price_cents, id) < ($CURSOR_VALUE::integer, $CURSOR_ID::uuid)',
  },
};

export class ProductPostgresRepository implements ProductRepositoryInterface {
  constructor(private readonly pool: Pool) {}

  async create(product: NewProduct): Promise<Product> {
    try {
      const { rows } = await this.pool.query<ProductRow>(
        `INSERT INTO products (sku, name, description, category, price_cents)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${COLUMNS}`,
        [product.sku, product.name, product.description, product.category, product.priceCents],
      );

      return toProduct(firstRow(rows));
    } catch (error) {
      throw mapUniqueViolation(error, product.sku);
    }
  }

  async findById(id: string): Promise<Product | null> {
    const { rows } = await this.pool.query<ProductRow>(`SELECT ${COLUMNS} FROM products WHERE id = $1`, [id]);

    return rows[0] ? toProduct(rows[0]) : null;
  }

  async update(id: string, changes: ProductChanges, expectedVersion?: number): Promise<Product | null> {
    const values: unknown[] = [id, expectedVersion ?? null];
    const assignments = ['version = version + 1', 'updated_at = now()'];

    for (const [key, column] of Object.entries(UPDATABLE_COLUMNS) as [keyof ProductChanges, string][]) {
      if (changes[key] !== undefined) {
        values.push(changes[key]);
        assignments.push(`${column} = $${values.length}`);
      }
    }

    try {
      const { rows } = await this.pool.query<ProductRow>(
        `UPDATE products SET ${assignments.join(', ')}
         WHERE id = $1 AND ($2::integer IS NULL OR version = $2::integer)
         RETURNING ${COLUMNS}`,
        values,
      );
      if (rows[0]) {
        return toProduct(rows[0]);
      }
    } catch (error) {
      throw mapUniqueViolation(error, changes.sku ?? '');
    }

    return this.notFoundOrConflict(id);
  }

  async delete(id: string, expectedVersion?: number): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      'DELETE FROM products WHERE id = $1 AND ($2::integer IS NULL OR version = $2::integer)',
      [id, expectedVersion ?? null],
    );
    if (rowCount) {
      return true;
    }

    return (await this.notFoundOrConflict(id)) !== null;
  }

  async list({ filter, sort, limit, after }: ProductListQuery): Promise<Product[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    const param = (value: unknown): string => {
      values.push(value);
      return `$${values.length}`;
    };

    if (filter.category !== undefined) {
      conditions.push(`category = ${param(filter.category)}`);
    }
    if (filter.minPriceCents !== undefined) {
      conditions.push(`price_cents >= ${param(filter.minPriceCents)}`);
    }
    if (filter.maxPriceCents !== undefined) {
      conditions.push(`price_cents <= ${param(filter.maxPriceCents)}`);
    }
    if (after) {
      conditions.push(
        SORTS[sort].after.replace('$CURSOR_VALUE', param(after.value)).replace('$CURSOR_ID', param(after.id)),
      );
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await this.pool.query<ProductRow>(
      `SELECT ${COLUMNS} FROM products ${where} ORDER BY ${SORTS[sort].orderBy} LIMIT ${param(limit)}`,
      values,
    );

    return rows.map(toProduct);
  }

  /**
   * An UPDATE or DELETE that touched no rows means either the product is gone or its version moved on.
   * Returns null for "gone" and throws for "version moved on".
   */
  private async notFoundOrConflict(id: string): Promise<null> {
    const existing = await this.findById(id);
    if (existing) {
      throw new VersionConflictError(id);
    }

    return null;
  }
}

const toProduct = (row: ProductRow): Product => ({
  id: row.id,
  sku: row.sku,
  name: row.name,
  description: row.description,
  category: row.category,
  priceCents: row.price_cents,
  version: row.version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const firstRow = (rows: ProductRow[]): ProductRow => {
  const [row] = rows;
  if (!row) {
    throw new Error('Expected the query to return a row');
  }

  return row;
};

const mapUniqueViolation = (error: unknown, sku: string): unknown =>
  error instanceof DatabaseError && error.code === UNIQUE_VIOLATION ? new DuplicateSkuError(sku) : error;
