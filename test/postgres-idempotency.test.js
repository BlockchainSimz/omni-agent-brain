import test from 'node:test';
import assert from 'node:assert/strict';
import { createPostgresPersistence } from '../src/postgres-runtime.js';
import { PostgresIdempotencyStore } from '../src/postgres-idempotency.js';

test('PostgreSQL idempotency persists completed results and rejects payload reuse', { skip: !process.env.OMNI_BRAIN_DATABASE_URL }, async () => {
  const runtime = createPostgresPersistence();
  const table = `omni_brain_idempotency_${process.pid}`;
  const store = new PostgresIdempotencyStore({ pool: runtime.persistence.pool, table, ttlMs: 60_000, leaseMs: 2_000 });
  let executions = 0;
  try {
    await store.init();
    const first = await store.run('integration-key', { value: 1 }, async () => {
      executions += 1;
      return { ok: true, value: 42 };
    });
    const second = await store.run('integration-key', { value: 1 }, async () => {
      executions += 1;
      return { ok: false };
    });
    assert.deepEqual(second, first);
    assert.equal(executions, 1);
    await assert.rejects(() => store.run('integration-key', { value: 2 }, async () => ({})), /idempotency_key_reused/);
  } finally {
    await runtime.persistence.pool.query(`DROP TABLE IF EXISTS ${table}`).catch(() => {});
    await runtime.close();
  }
});

test('PostgreSQL idempotency validates table identifiers', () => {
  assert.throws(() => new PostgresIdempotencyStore({ pool: { query() {}, transaction() {} }, table: 'bad;drop' }), /invalid_idempotency_table/);
});
