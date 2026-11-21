import { Pool } from 'pg';

export const createPool = (connectionString: string): Pool => {
  const pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
  });

  // When Postgres closes an idle connection (restart, failover, admin command) the pool emits 'error'.
  // Without a listener Node treats that as unhandled and the process crashes. The pool already drops
  // the broken connection and opens a new one on the next query, so logging is all we need to do.
  pool.on('error', (error) => {
    console.error(JSON.stringify({ level: 'warn', msg: 'Idle database connection was closed', error: error.message }));
  });

  return pool;
};
