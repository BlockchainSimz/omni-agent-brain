import postgres from 'postgres';
import { PostgresPersistence } from './postgres-persistence.js';

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const MIGRATION_LOCK_KEY = 4815162342;

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
    },
    async transaction(callback) {
      const connection = await sql.reserve();
      try {
        await connection.unsafe('BEGIN');
        const result = await callback({
          async query(text, params = []) {
            const rows = await connection.unsafe(text, params);
            return { rows };
          }
        });
        await connection.unsafe('COMMIT');
        return result;
      } catch (error) {
        await connection.unsafe('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        connection.release();
      }
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
  await persistence.pool.transaction(async tx => {
    // Serialize startup migrations across concurrent application instances.
    // The transaction-scoped advisory lock is released automatically on commit/rollback.
    await tx.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK_KEY]);
    await tx.query(`CREATE TABLE IF NOT EXISTS ${persistence.table} (id SMALLINT PRIMARY KEY CHECK (id = 1), schema_version INTEGER NOT NULL, state JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await tx.query(`CREATE INDEX IF NOT EXISTS ${persistence.table}_updated_at_idx ON ${persistence.table} (updated_at)`);
    await tx.query('CREATE EXTENSION IF NOT EXISTS vector');
    await tx.query('CREATE TABLE IF NOT EXISTS omni_brain_vectors (memory_id TEXT PRIMARY KEY, embedding vector(256) NOT NULL, memory JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
    await tx.query('CREATE INDEX IF NOT EXISTS omni_brain_vectors_embedding_hnsw_idx ON omni_brain_vectors USING hnsw (embedding vector_cosine_ops)');
    await tx.query('CREATE INDEX IF NOT EXISTS omni_brain_vectors_updated_at_idx ON omni_brain_vectors (updated_at)');
  });
}

export { MIGRATION_LOCK_KEY };
