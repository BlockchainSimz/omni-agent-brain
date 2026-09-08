import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createPostgresPersistence } from '../src/postgres-runtime.js';
import { PostgresIdempotencyStore } from '../src/postgres-idempotency.js';

function fingerprint(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload ?? null)).digest('hex');
}

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

test('PostgreSQL idempotency coalesces concurrent same-key operations', { skip: !process.env.OMNI_BRAIN_DATABASE_URL }, async () => {
  const runtime = createPostgresPersistence();
  const table = `omni_brain_idempotency_concurrent_${process.pid}`;
  const store = new PostgresIdempotencyStore({ pool: runtime.persistence.pool, table, ttlMs: 60_000, leaseMs: 2_000 });
  let executions = 0;
  try {
    await store.init();
    const operation = async () => {
      executions += 1;
      await new Promise(resolve => setTimeout(resolve, 150));
      return { ok: true, execution: executions };
    };
    const [first, second] = await Promise.all([
      store.run('concurrent-key', { value: 1 }, operation),
      store.run('concurrent-key', { value: 1 }, operation)
    ]);
    assert.deepEqual(second, first);
    assert.equal(executions, 1);
  } finally {
    await runtime.persistence.pool.query(`DROP TABLE IF EXISTS ${table}`).catch(() => {});
    await runtime.close();
  }
});

test('PostgreSQL idempotency reclaims an expired pending lease for the same fingerprint', { skip: !process.env.OMNI_BRAIN_DATABASE_URL }, async () => {
  const runtime = createPostgresPersistence();
  const table = `omni_brain_idempotency_reclaim_${process.pid}`;
  const store = new PostgresIdempotencyStore({ pool: runtime.persistence.pool, table, ttlMs: 60_000, leaseMs: 2_000 });
  const payload = { value: 7 };
  try {
    await store.init();
    const fp = fingerprint(payload);
    await runtime.persistence.pool.query(
      `INSERT INTO ${table} (key, fingerprint, status, expires_at, lease_until) VALUES ($1, $2, 'pending', NOW() + INTERVAL '1 minute', NOW() - INTERVAL '1 second')`,
      ['reclaim-key', fp]
    );
    const result = await store.run('reclaim-key', payload, async () => ({ recovered: true }));
    assert.deepEqual(result, { recovered: true });
  } finally {
    await runtime.persistence.pool.query(`DROP TABLE IF EXISTS ${table}`).catch(() => {});
    await runtime.close();
  }
});

test('PostgreSQL idempotency validates table identifiers', () => {
  assert.throws(() => new PostgresIdempotencyStore({ pool: { query() {}, transaction() {} }, table: 'bad;drop' }), /invalid_idempotency_table/);
});
