import test from 'node:test';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { PostgresVectorStore } from '../src/postgres-vector-store.js';

function fakePool() {
  const rows = new Map();
  return {
    rows,
    async query(text, params = []) {
      if (text.startsWith('CREATE') || text.startsWith('CREATE INDEX')) return { rows: [] };
      if (text.startsWith('INSERT')) {
        rows.set(params[0], { memory: JSON.parse(params[2]), score: 1 });
        return { rows: [] };
      }
      if (text.startsWith('DELETE FROM') && text.includes('memory_id = $1')) {
        rows.delete(params[0]);
        return { rows: [] };
      }
      if (text.startsWith('DELETE FROM')) {
        for (const id of rows.keys()) if (!params[0].includes(id)) rows.delete(id);
        return { rows: [] };
      }
      if (text.startsWith('SELECT COUNT')) return { rows: [{ count: rows.size }] };
      if (text.startsWith('SELECT memory')) return { rows: [...rows.values()] };
      return { rows: [] };
    }
  };
}

test('postgres vector store validates configuration', () => {
  assert.throws(() => new PostgresVectorStore({ pool: {} }), /invalid_postgres_pool/);
  assert.throws(() => new PostgresVectorStore({ pool: fakePool(), table: 'bad-name' }), /invalid_postgres_table/);
});

test('postgres vector store syncs active memories and removes inactive ones', async () => {
  const pool = fakePool();
  const store = new PostgresVectorStore({ pool });
  await store.init();
  const snapshot = { memories: [
    { id: 'one', content: 'API retries', source: 'test', status: 'validated', confidence: 1 },
    { id: 'rejected', content: 'secret', source: 'test', status: 'rejected', confidence: 1 }
  ] };
  await store.sync(snapshot);
  assert.equal(await store.count(), 1);
  assert.ok(pool.rows.has('one'));
  assert.equal(pool.rows.has('rejected'), false);
});

test('postgres vector store persists and retrieves semantic memories with pgvector', { skip: !process.env.OMNI_BRAIN_DATABASE_URL }, async () => {
  const sql = postgres(process.env.OMNI_BRAIN_DATABASE_URL);
  const table = `omni_brain_vectors_test_${process.pid}`;
  const pool = {
    async query(text, params = []) {
      return { rows: await sql.unsafe(text.replaceAll('omni_brain_vectors', table), params) };
    }
  };
  const store = new PostgresVectorStore({ pool, table });
  try {
    await store.init();
    await store.sync({ memories: [
      { id: 'api', content: 'bounded retries for idempotent API requests', source: 'test', status: 'validated', confidence: 1 },
      { id: 'hiking', content: 'mountain hiking checklist and river trail notes', source: 'test', status: 'validated', confidence: 1 }
    ] });
    const results = await store.search('API retry strategy', { limit: 2 });
    assert.equal(results[0].id, 'api');
    assert.ok(results[0].score > results[1].score);
    assert.equal(await store.count(), 2);
  } finally {
    await sql.unsafe(`DROP TABLE IF EXISTS ${table}`);
    await sql.end({ timeout: 5 });
  }
});
