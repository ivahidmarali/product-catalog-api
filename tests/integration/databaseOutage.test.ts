import { createPool } from '../../src/Infrastructure/Postgres/pool';
import { startTestApp, stopTestApp, TestContext } from './testApp';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestApp();
});

afterAll(async () => {
  await stopTestApp(ctx);
});

it('keeps serving after Postgres closes its idle connections', async () => {
  // Warm the pool so it holds an idle connection.
  expect((await ctx.app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  const { rows } = await ctx.pool.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');

  // Kill that connection from the outside, the way a database restart or failover would.
  const admin = createPool(process.env.TEST_DATABASE_URL ?? 'postgres://catalog:catalog@localhost:5432/catalog_test');
  await admin.query('SELECT pg_terminate_backend($1)', [rows[0]?.pid]);
  await admin.end();
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Without a pool error listener the process would have crashed by now.
  expect((await ctx.app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  expect((await ctx.app.inject({ method: 'GET', url: '/products?limit=1' })).statusCode).toBe(200);
});
