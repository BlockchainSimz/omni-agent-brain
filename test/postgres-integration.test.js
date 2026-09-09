import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncBrainStore } from '../src/async-brain.js';
import { createPostgresPersistence, runPostgresMigration } from '../src/postgres-runtime.js';
import { PostgresPersistence } from '../src/postgres-persistence.js';

test('PostgreSQL persistence survives a real database round trip', { skip: !process.env.OMNI_BRAIN_DATABASE_URL }, async () => {
  const runtime = createPostgresPersistence();
  try {
    await runPostgresMigration(runtime.persistence);
    await runtime.persistence.pool.query('DELETE FROM omni_brain_state WHERE id = 1');

    const first = new AsyncBrainStore(runtime.persistence);
    const memory = await first.remember({ content: 'real postgres fact', source: 'integration-test' });

    const second = new AsyncBrainStore(runtime.persistence);
    const snapshot = await second.snapshot();
    assert.equal(snapshot.memories[0].id, memory.id);
    assert.equal(await second.verifyAudit(), true);
    assert.equal(await runtime.persistence.healthcheck(), true);
  } finally {
    await runtime.persistence.pool.query('DELETE FROM omni_brain_state WHERE id = 1').catch(() => {});
    await runtime.close();
  }
});

test('PostgreSQL persistence preserves concurrent writes across AsyncBrainStore instances', { skip: !process.env.OMNI_BRAIN_DATABASE_URL }, async () => {
  const runtime = createPostgresPersistence();
  try {
    await runPostgresMigration(runtime.persistence);
    await runtime.persistence.pool.query('DELETE FROM omni_brain_state WHERE id = 1');
    const first = new AsyncBrainStore(runtime.persistence);
    const second = new AsyncBrainStore(runtime.persistence);
    await Promise.all([
      first.remember({ content: 'postgres-writer-one', source: 'integration-test' }),
      second.remember({ content: 'postgres-writer-two', source: 'integration-test' })
    ]);
    const reloaded = new AsyncBrainStore(runtime.persistence);
    const snapshot = await reloaded.snapshot();
    assert.equal(snapshot.memories.length, 2);
    assert.deepEqual(new Set(snapshot.memories.map(memory => memory.content)), new Set(['postgres-writer-one', 'postgres-writer-two']));
    assert.equal(snapshot.audit.length, 2);
    assert.equal(await reloaded.verifyAudit(), true);
  } finally {
    await runtime.persistence.pool.query('DELETE FROM omni_brain_state WHERE id = 1').catch(() => {});
    await runtime.close();
  }
});

test('PostgreSQL startup migrations serialize safely across concurrent runtimes', { skip: !process.env.OMNI_BRAIN_DATABASE_URL }, async () => {
  const first = createPostgresPersistence();
  const second = createPostgresPersistence();
  try {
    await Promise.all([
      runPostgresMigration(first.persistence),
      runPostgresMigration(second.persistence)
    ]);
    const result = await first.persistence.pool.query("SELECT extname FROM pg_extension WHERE extname = 'vector'");
    assert.equal(result.rows.length, 1);
  } finally {
    await first.close();
    await second.close();
  }
});

test('PostgreSQL runtime requires an explicit connection URL', () => {
  assert.throws(() => createPostgresPersistence({ url: '' }), /missing_postgres_database_url/);
});

test('PostgreSQL migration failures are surfaced to startup callers', async () => {
  const persistence = {
    table: 'omni_brain_state',
    pool: { query: async () => { throw new Error('database_unavailable'); } }
  };
  await assert.rejects(() => runPostgresMigration(persistence), /database_unavailable/);
});

test('PostgreSQL healthcheck propagates connection failures', async () => {
  const persistence = new PostgresPersistence({ pool: { query: async () => { throw new Error('connection_lost'); } } });
  await assert.rejects(() => persistence.healthcheck(), /connection_lost/);
});
