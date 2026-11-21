import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { ProductService } from '../../src/Application/Product/ProductService';
import { buildApp } from '../../src/Infrastructure/Http/buildApp';
import { runMigrations } from '../../src/Infrastructure/Postgres/migrate';
import { createPool } from '../../src/Infrastructure/Postgres/pool';
import { ProductPostgresRepository } from '../../src/Infrastructure/Postgres/ProductPostgresRepository';

export const API_KEY = 'integration-test-api-key';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://catalog:catalog@localhost:5432/catalog_test';

export type TestContext = { app: FastifyInstance; pool: Pool };

export const startTestApp = async (): Promise<TestContext> => {
  const pool = createPool(TEST_DATABASE_URL);
  await runMigrations(pool);
  const app = await buildApp({
    productService: new ProductService(new ProductPostgresRepository(pool)),
    checkDatabase: async () => {
      await pool.query('SELECT 1');
    },
    writeApiKey: API_KEY,
  });

  return { app, pool };
};

export const stopTestApp = async ({ app, pool }: TestContext): Promise<void> => {
  await app.close();
  await pool.end();
};

export const clearProducts = async ({ pool }: TestContext): Promise<void> => {
  await pool.query('TRUNCATE products');
};
