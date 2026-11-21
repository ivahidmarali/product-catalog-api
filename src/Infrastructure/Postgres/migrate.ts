import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';
import { loadConfig } from '../../Core/config';
import { createPool } from './pool';

// Any constant works; it only has to be the same for every instance running migrations.
const MIGRATION_LOCK_ID = 727_001;

export const runMigrations = async (pool: Pool, directory = join(process.cwd(), 'migrations')): Promise<string[]> => {
  const client = await pool.connect();
  const applied: string[] = [];

  try {
    // Several API instances can start at the same time. The lock makes sure only one migrates.
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );

    const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const done = new Set(rows.map((row) => row.name));
    const files = (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort();

    for (const file of files) {
      if (done.has(file)) {
        continue;
      }

      const sql = await readFile(join(directory, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
    client.release();
  }

  return applied;
};

if (require.main === module) {
  const pool = createPool(loadConfig().DATABASE_URL);
  runMigrations(pool)
    .then((applied) => console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date'))
    .catch((error: unknown) => {
      console.error('Migration failed', error);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
