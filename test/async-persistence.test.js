import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncPersistenceAdapter } from '../src/async-persistence.js';

class FakeAdapter {
  constructor() { this.saved = null; this.healthchecks = 0; }
  async load() { return this.saved; }
  async save(snapshot) { this.saved = structuredClone(snapshot); }
  async healthcheck() { this.healthchecks += 1; return true; }
}

test('async persistence adapter preserves the canonical snapshot contract', async () => {
  const adapter = new FakeAdapter();
  const persistence = new AsyncPersistenceAdapter(adapter);
  const snapshot = { memories: [], skills: [], executions: [], audit: [] };
  await persistence.save(snapshot);
  assert.deepEqual(adapter.saved, snapshot);
  assert.equal(adapter.saved.schemaVersion, undefined);
  assert.deepEqual(await persistence.load(), snapshot);
});

test('async persistence adapter validates loaded and saved snapshots', async () => {
  const adapter = new FakeAdapter();
  const persistence = new AsyncPersistenceAdapter(adapter);
  await assert.rejects(() => persistence.save({ memories: 'invalid' }), /invalid_persistence_memories/);
  adapter.saved = { memories: 'invalid' };
  await assert.rejects(() => persistence.load(), /invalid_persistence_memories/);
});

test('async persistence adapter delegates healthchecks', async () => {
  const adapter = new FakeAdapter();
  const persistence = new AsyncPersistenceAdapter(adapter);
  assert.equal(await persistence.healthcheck(), true);
  assert.equal(adapter.healthchecks, 1);
});
