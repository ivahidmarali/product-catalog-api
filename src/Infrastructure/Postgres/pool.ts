import { Pool } from 'pg';

export const createPool = (connectionString: string): Pool =>
  new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
  });
