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
