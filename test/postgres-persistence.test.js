import test from 'node:test';
import assert from 'node:assert/strict';
import { PostgresPersistence } from '../src/postgres-persistence.js';

function fakePool(rows = []) {
  const calls = [];
  return {
    calls,
    async query(text, params) { calls.push({ text, params }); if (text.startsWith('SELECT')) return { rows }; return { rows: [] }; }
  };
}

test('rejects unsafe PostgreSQL table identifiers', () => {
  assert.throws(() => new PostgresPersistence({ pool: fakePool(), table: 'state;drop table x' }), /invalid_postgres_table/);
});

test('initializes an empty PostgreSQL state table safely', async () => {
  const pool = fakePool([]);
  const persistence = new PostgresPersistence({ pool });
  assert.equal(await persistence.init(), null);
  assert.match(pool.calls[0].text, /CREATE TABLE IF NOT EXISTS/);
});

test('loads and validates a PostgreSQL snapshot', async () => {
  const snapshot = { schemaVersion: 1, memories: [], skills: [], executions: [], audit: [] };
  const pool = fakePool([{ schema_version: 1, state: snapshot }]);
  const persistence = new PostgresPersistence({ pool });
  assert.deepEqual(await persistence.load(), snapshot);
});

test('saves a validated snapshot with parameterized JSON', async () => {
  const pool = fakePool([]);
  const persistence = new PostgresPersistence({ pool });
  const snapshot = { memories: [], skills: [], executions: [], audit: [] };
  await persistence.save(snapshot);
  const call = pool.calls[0];
  assert.match(call.text, /ON CONFLICT \(id\)/);
  assert.equal(call.params[0], 1);
  assert.equal(JSON.parse(call.params[1]).schemaVersion, undefined);
});

test('healthcheck uses a trivial query', async () => {
  const pool = fakePool([]);
  const persistence = new PostgresPersistence({ pool });
  assert.equal(await persistence.healthcheck(), true);
  assert.equal(pool.calls[0].text, 'SELECT 1');
});
