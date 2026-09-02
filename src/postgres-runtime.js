import postgres from 'postgres';
import { PostgresPersistence } from './postgres-persistence.js';

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

export function createPostgresPersistence({ url = process.env.OMNI_BRAIN_DATABASE_URL, table = 'omni_brain_state', ...options } = {}) {
  if (!url) throw new Error('missing_postgres_database_url');
  if (!IDENTIFIER.test(table)) throw new Error('invalid_postgres_table');

  const sql = postgres(url, {
    max: Number(options.maxConnections || 10),
    idle_timeout: Number(options.idleTimeoutSeconds || 20),
    connect_timeout: Number(options.connectTimeoutSeconds || 10),
    ...options.clientOptions
  });

  const pool = {
    async query(text, params = []) {
      const rows = await sql.unsafe(text, params);
      return { rows };
    }
  };

  const persistence = new PostgresPersistence({ pool, table });
  return {
    persistence,
    async close() { await sql.end({ timeout: 5 }); },
    sql
  };
}

export async function runPostgresMigration(persistence) {
  await persistence.pool.query(`CREATE TABLE IF NOT EXISTS ${persistence.table} (id SMALLINT PRIMARY KEY CHECK (id = 1), schema_version INTEGER NOT NULL, state JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await persistence.pool.query(`CREATE INDEX IF NOT EXISTS ${persistence.table}_updated_at_idx ON ${persistence.table} (updated_at)`);
}
