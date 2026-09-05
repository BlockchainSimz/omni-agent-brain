import crypto from 'node:crypto';

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const KEY = /^[A-Za-z0-9._:-]{1,128}$/;

export class PostgresIdempotencyStore {
  constructor({ pool, table = 'omni_brain_idempotency', ttlMs = 600_000, leaseMs = 30_000 } = {}) {
    if (!pool || typeof pool.query !== 'function' || typeof pool.transaction !== 'function') throw new Error('invalid_idempotency_backend');
    if (!IDENTIFIER.test(table)) throw new Error('invalid_idempotency_table');
    if (!Number.isFinite(ttlMs) || ttlMs < 1) throw new Error('invalid_idempotency_ttl');
    if (!Number.isFinite(leaseMs) || leaseMs < 1) throw new Error('invalid_idempotency_lease');
    this.pool = pool;
    this.table = table;
    this.ttlMs = ttlMs;
    this.leaseMs = leaseMs;
  }

  async init() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS ${this.table} (key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('pending','completed')), result JSONB, expires_at TIMESTAMPTZ NOT NULL, lease_until TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await this.pool.query(`CREATE INDEX IF NOT EXISTS ${this.table}_expires_at_idx ON ${this.table} (expires_at)`);
  }

  async run(key, payload, operation) {
    if (!KEY.test(key)) throw new Error('invalid_idempotency_key');
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify(payload ?? null)).digest('hex');
    const claimed = await this.#claim(key, fingerprint);
    if (claimed.kind === 'completed') return claimed.result;
    if (claimed.kind === 'wait') return this.#wait(key, fingerprint);

    try {
      const result = await operation();
      await this.pool.query(`UPDATE ${this.table} SET status = 'completed', result = $2::jsonb, updated_at = NOW(), lease_until = NOW() WHERE key = $1 AND fingerprint = $3 AND status = 'pending'`, [key, JSON.stringify(result), fingerprint]);
      return result;
    } catch (error) {
      await this.pool.query(`DELETE FROM ${this.table} WHERE key = $1 AND fingerprint = $2 AND status = 'pending'`, [key, fingerprint]).catch(() => {});
      throw error;
    }
  }

  async #claim(key, fingerprint) {
    return this.pool.transaction(async tx => {
      const existing = await tx.query(`SELECT fingerprint, status, result, lease_until, expires_at FROM ${this.table} WHERE key = $1 FOR UPDATE`, [key]);
      if (existing.rows.length === 0) {
        await tx.query(`INSERT INTO ${this.table} (key, fingerprint, status, expires_at, lease_until) VALUES ($1, $2, 'pending', NOW() + ($3 * INTERVAL '1 millisecond'), NOW() + ($4 * INTERVAL '1 millisecond'))`, [key, fingerprint, this.ttlMs, this.leaseMs]);
        return { kind: 'owner' };
      }
      const row = existing.rows[0];
      if (row.fingerprint !== fingerprint) {
        const error = new Error('idempotency_key_reused');
        error.statusCode = 409;
        throw error;
      }
      if (row.status === 'completed' && Number(new Date(row.expires_at)) > Date.now()) return { kind: 'completed', result: typeof row.result === 'string' ? JSON.parse(row.result) : row.result };
      if (Number(new Date(row.lease_until)) <= Date.now()) {
        await tx.query(`UPDATE ${this.table} SET status = 'pending', result = NULL, expires_at = NOW() + ($2 * INTERVAL '1 millisecond'), lease_until = NOW() + ($3 * INTERVAL '1 millisecond'), updated_at = NOW() WHERE key = $1`, [key, this.ttlMs, this.leaseMs]);
        return { kind: 'owner' };
      }
      return { kind: 'wait' };
    });
  }

  async #wait(key, fingerprint) {
    const deadline = Date.now() + this.leaseMs + 5_000;
    while (Date.now() < deadline) {
      const result = await this.pool.query(`SELECT fingerprint, status, result, lease_until, expires_at FROM ${this.table} WHERE key = $1`, [key]);
      const row = result.rows[0];
      if (!row) { await new Promise(resolve => setTimeout(resolve, 25)); continue; }
      if (row.fingerprint !== fingerprint) { const error = new Error('idempotency_key_reused'); error.statusCode = 409; throw error; }
      if (row.status === 'completed' && Number(new Date(row.expires_at)) > Date.now()) return typeof row.result === 'string' ? JSON.parse(row.result) : row.result;
      if (Number(new Date(row.lease_until)) <= Date.now()) return this.run(key, null, async () => { throw new Error('idempotency_claim_lost'); });
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    const error = new Error('idempotency_in_progress');
    error.statusCode = 409;
    throw error;
  }

  async clearExpired() {
    await this.pool.query(`DELETE FROM ${this.table} WHERE expires_at <= NOW()`);
  }
}
