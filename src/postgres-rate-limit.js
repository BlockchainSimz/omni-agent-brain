const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

export class PostgresRateLimitBackend {
  constructor({ pool, table = 'omni_brain_rate_limits' } = {}) {
    if (!pool || typeof pool.query !== 'function') throw new Error('invalid_rate_limit_backend');
    if (!IDENTIFIER.test(table)) throw new Error('invalid_rate_limit_table');
    this.pool = pool;
    this.table = table;
  }

  async init() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS ${this.table} (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at TIMESTAMPTZ NOT NULL)`);
    await this.pool.query(`CREATE INDEX IF NOT EXISTS ${this.table}_reset_at_idx ON ${this.table} (reset_at)`);
  }

  async increment(key, windowMs) {
    if (!key) throw new Error('rate_limit_key_required');
    const result = await this.pool.query(
      `INSERT INTO ${this.table} (key, count, reset_at) VALUES ($1, 1, NOW() + ($2 * INTERVAL '1 millisecond')) ON CONFLICT (key) DO UPDATE SET count = CASE WHEN ${this.table}.reset_at <= NOW() THEN 1 ELSE ${this.table}.count + 1 END, reset_at = CASE WHEN ${this.table}.reset_at <= NOW() THEN NOW() + ($2 * INTERVAL '1 millisecond') ELSE ${this.table}.reset_at END RETURNING count, EXTRACT(EPOCH FROM reset_at) * 1000 AS reset_at`,
      [key, windowMs]
    );
    const row = result.rows[0];
    return { count: Number(row.count), resetAt: Number(row.reset_at) };
  }

  async clearExpired() {
    await this.pool.query(`DELETE FROM ${this.table} WHERE reset_at <= NOW()`);
  }
}
