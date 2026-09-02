import { validateSnapshot, PERSISTENCE_SCHEMA_VERSION } from './persistence.js';

export class PostgresPersistence {
  constructor({ pool, table = 'omni_brain_state' } = {}) {
    if (!pool || typeof pool.query !== 'function') throw new Error('invalid_postgres_pool');
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(table)) throw new Error('invalid_postgres_table');
    this.pool = pool;
    this.table = table;
  }

  async init() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS ${this.table} (id SMALLINT PRIMARY KEY CHECK (id = 1), schema_version INTEGER NOT NULL, state JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    const result = await this.pool.query(`SELECT schema_version, state FROM ${this.table} WHERE id = 1`);
    if (result.rows.length === 0) return null;
    if (result.rows[0].schema_version !== PERSISTENCE_SCHEMA_VERSION) throw new Error('unsupported_persistence_schema');
    return validateSnapshot(result.rows[0].state);
  }

  async load() {
    const result = await this.pool.query(`SELECT schema_version, state FROM ${this.table} WHERE id = 1`);
    if (result.rows.length === 0) return null;
    if (result.rows[0].schema_version !== PERSISTENCE_SCHEMA_VERSION) throw new Error('unsupported_persistence_schema');
    return validateSnapshot(result.rows[0].state);
  }

  async save(snapshot) {
    const value = validateSnapshot(snapshot);
    await this.pool.query(
      `INSERT INTO ${this.table} (id, schema_version, state, updated_at) VALUES (1, $1, $2::jsonb, NOW()) ON CONFLICT (id) DO UPDATE SET schema_version = EXCLUDED.schema_version, state = EXCLUDED.state, updated_at = NOW()`,
      [PERSISTENCE_SCHEMA_VERSION, JSON.stringify(value)]
    );
  }

  async healthcheck() {
    await this.pool.query('SELECT 1');
    return true;
  }
}
