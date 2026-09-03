import test from 'node:test';
import assert from 'node:assert/strict';
import { PostgresRateLimitBackend } from '../src/postgres-rate-limit.js';
import { createPostgresPersistence } from '../src/postgres-runtime.js';

test('PostgreSQL rate limiter enforces a shared atomic window', { skip: !process.env.OMNI_BRAIN_DATABASE_URL }, async () => {
  const runtime = createPostgresPersistence();
  const table = `omni_brain_rate_limits_${process.pid}`;
  const backend = new PostgresRateLimitBackend({ pool: runtime.persistence.pool, table });
  try {
    await backend.init();
    await runtime.persistence.pool.query(`DELETE FROM ${table}`);
    const first = await backend.increment('integration-client', 60_000);
    const second = await backend.increment('integration-client', 60_000);
    assert.equal(first.count, 1);
    assert.equal(second.count, 2);
    assert.equal(second.resetAt >= first.resetAt - 1000, true);
  } finally {
    await runtime.persistence.pool.query(`DROP TABLE IF EXISTS ${table}`).catch(() => {});
    await runtime.close();
  }
});

test('PostgreSQL rate limiter validates table identifiers', () => {
  assert.throws(() => new PostgresRateLimitBackend({ pool: { query() {} }, table: 'bad;drop' }), /invalid_rate_limit_table/);
});
