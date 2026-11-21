import { ProductService } from './Application/Product/ProductService';
import { loadConfig } from './Core/config';
import { buildApp } from './Infrastructure/Http/buildApp';
import { createPool } from './Infrastructure/Postgres/pool';
import { ProductPostgresRepository } from './Infrastructure/Postgres/ProductPostgresRepository';

const start = async (): Promise<void> => {
  const config = loadConfig();
  const pool = createPool(config.DATABASE_URL);

  const app = await buildApp({
    productService: new ProductService(new ProductPostgresRepository(pool)),
    checkDatabase: async () => {
      await pool.query('SELECT 1');
    },
    logger: { level: config.LOG_LEVEL },
  });

  const shutdown = async (): Promise<void> => {
    await app.close();
    await pool.end();
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());

  await app.listen({ host: '0.0.0.0', port: config.PORT });
};

start().catch((error: unknown) => {
  console.error('Failed to start', error);
  process.exit(1);
});
