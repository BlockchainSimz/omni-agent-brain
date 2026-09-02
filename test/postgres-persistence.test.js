import test from 'node:test';
import assert from 'node:assert/strict';
import { PostgresPersistence } from '../src/postgres-persistence.js';

function fakePool(rows = []) {
  const calls = [];
  let currentRows = rows;
  return {
    calls,
    async query(text, params) {
      calls.push({ text, params });
      if (text.startsWith('SELECT schema_version')) return { rows: currentRows };
      if (text.startsWith('INSERT INTO')) {
        currentRows = [{ schema_version: params[0], state: JSON.parse(params[1]) }];
      }
      return { rows: [] };
    }
  };
}

test('rejects invalid PostgreSQL pool and unsafe table identifiers', () => {
  assert.throws(() => new PostgresPersistence(), /invalid_postgres_pool/);
  assert.throws(() => new PostgresPersistence({ pool: fakePool(), table: 'state;drop table x' }), /invalid_postgres_table/);
});

test('initializes an empty PostgreSQL state table safely', async () => {
  const pool = fakePool([]);
  const persistence = new PostgresPersistence({ pool });
  assert.equal(await persistence.init(), null);
  assert.match(pool.calls[0].text, /CREATE TABLE IF NOT EXISTS/);
});

test('saves and reloads a validated PostgreSQL snapshot', async () => {
  const pool = fakePool([]);
  const persistence = new PostgresPersistence({ pool });
  const snapshot = { memories: [{ id: 'm1' }], skills: [], executions: [], audit: [] };
  await persistence.save(snapshot);
  assert.deepEqual(await persistence.load(), snapshot);
  const call = pool.calls.find(x => x.text.startsWith('INSERT INTO'));
  assert.match(call.text, /ON CONFLICT \(id\)/);
  assert.equal(call.params[0], 1);
  assert.equal(JSON.parse(call.params[1]).schemaVersion, undefined);
});

test('rejects unsupported PostgreSQL schema versions', async () => {
  const pool = fakePool([{ schema_version: 999, state: {} }]);
  const persistence = new PostgresPersistence({ pool });
  await assert.rejects(() => persistence.load(), /unsupported_persistence_schema/);
});

test('healthcheck uses a trivial query', async () => {
  const pool = fakePool([]);
  const persistence = new PostgresPersistence({ pool });
  assert.equal(await persistence.healthcheck(), true);
  assert.equal(pool.calls[0].text, 'SELECT 1');
});
