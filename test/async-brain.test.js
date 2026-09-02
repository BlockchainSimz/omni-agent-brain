import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncBrainStore } from '../src/async-brain.js';

class FakeAsyncPersistence {
  constructor(snapshot = null) { this.snapshot = snapshot; this.saves = 0; }
  async load() { return this.snapshot ? structuredClone(this.snapshot) : null; }
  async save(snapshot) { this.snapshot = structuredClone(snapshot); this.saves += 1; }
}

test('async brain loads, persists, and reloads state', async () => {
  const persistence = new FakeAsyncPersistence();
  const first = new AsyncBrainStore(persistence);
  const memory = await first.remember({ content: 'durable async fact', source: 'test' });
  assert.equal(persistence.saves, 1);

  const second = new AsyncBrainStore(persistence);
  const snapshot = await second.snapshot();
  assert.equal(snapshot.memories[0].id, memory.id);
  assert.equal(await second.verifyAudit(), true);
});

test('serializes concurrent writes without losing audit entries', async () => {
  const persistence = new FakeAsyncPersistence();
  const brain = new AsyncBrainStore(persistence);
  const results = await Promise.all([
    brain.remember({ content: 'one', source: 'test' }),
    brain.remember({ content: 'two', source: 'test' }),
    brain.remember({ content: 'three', source: 'test' })
  ]);
  const snapshot = await brain.snapshot();
  assert.equal(results.length, 3);
  assert.equal(snapshot.memories.length, 3);
  assert.equal(snapshot.audit.length, 3);
  assert.equal(await brain.verifyAudit(), true);
});

test('propagates persistence failures without poisoning later writes', async () => {
  let fail = true;
  const persistence = {
    snapshot: null,
    async load() { return this.snapshot; },
    async save(snapshot) {
      if (fail) { fail = false; throw new Error('db unavailable'); }
      this.snapshot = structuredClone(snapshot);
    }
  };
  const brain = new AsyncBrainStore(persistence);
  await assert.rejects(() => brain.remember({ content: 'first', source: 'test' }), /db unavailable/);
  await brain.remember({ content: 'second', source: 'test' });
  assert.equal((await brain.snapshot()).memories.length, 2);
});
