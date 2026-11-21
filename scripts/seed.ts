import { loadConfig } from '../src/Core/config';
import { createPool } from '../src/Infrastructure/Postgres/pool';

const DEFAULT_COUNT = 300_000;
const CATEGORIES = ['shoes', 'shirts', 'shorts', 'jackets', 'bags', 'socks', 'hats', 'pants', 'hoodies', 'accessories'];

/**
 * Fills the catalog with fake products so list queries can be tried at a realistic size.
 * Postgres generates the rows itself, which takes a few seconds for 300k.
 * Usage: npm run seed [count]
 */
const seed = async (): Promise<void> => {
  const count = Number(process.argv[2] ?? DEFAULT_COUNT);
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error(`Count must be a positive whole number, got "${process.argv[2]}"`);
  }

  const pool = createPool(loadConfig().DATABASE_URL);
  try {
    const started = Date.now();
    const { rowCount } = await pool.query(
      `INSERT INTO products (sku, name, description, category, price_cents, created_at, updated_at)
       SELECT 'SEED-' || n,
              'Product ' || n,
              'Generated product for load testing',
              ($2::text[])[1 + floor(random() * array_length($2::text[], 1))::int],
              (500 + floor(random() * 50000))::int,
              created_at,
              created_at
       FROM (
         -- random() is evaluated per row here, so every product gets its own timestamp within the last year.
         SELECT n, now() - random() * interval '365 days' AS created_at
         FROM generate_series(1, $1::int) AS n
       ) AS generated
       ON CONFLICT (sku) DO NOTHING`,
      [count, CATEGORIES],
    );
    await pool.query('ANALYZE products');

    console.log(`Inserted ${rowCount} products in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  } finally {
    await pool.end();
  }
};

seed().catch((error: unknown) => {
  console.error('Seeding failed', error);
  process.exitCode = 1;
});
