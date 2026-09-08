import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncBrainStore } from '../src/async-brain.js';

class FakeAsyncPersistence {
  constructor(snapshot = null) { this.snapshot = snapshot; this.saves = 0; }
  async load() { return this.snapshot ? structuredClone(this.snapshot) : null; }
  async save(snapshot) { this.snapshot = structuredClone(snapshot); this.saves += 1; }
}

class FakeLockedPersistence extends FakeAsyncPersistence {
  constructor(snapshot = null) {
    super(snapshot);
    this.lock = Promise.resolve();
  }

  async withWriteLock(operation) {
    const previous = this.lock;
    let release;
    this.lock = new Promise(resolve => { release = resolve; });
    await previous;
    try {
      return await operation({
        load: () => this.load(),
        save: snapshot => this.save(snapshot)
      });
    } finally {
      release();
    }
  }
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

test('distributed async writers persist both updates under the shared write lock', async () => {
  const persistence = new FakeLockedPersistence();
  const first = new AsyncBrainStore(persistence);
  const second = new AsyncBrainStore(persistence);
  await Promise.all([
    first.remember({ content: 'writer-one', source: 'test' }),
    second.remember({ content: 'writer-two', source: 'test' })
  ]);
  const reloaded = new AsyncBrainStore(persistence);
  const snapshot = await reloaded.snapshot();
  assert.equal(snapshot.memories.length, 2);
  assert.deepEqual(new Set(snapshot.memories.map(memory => memory.content)), new Set(['writer-one', 'writer-two']));
  assert.equal(snapshot.audit.length, 2);
  assert.equal(await reloaded.verifyAudit(), true);
});

test('rolls back in-memory state when persistence fails and permits a later write', async () => {
  let fail = true;
  const persistence = {
    snapshot: null,
    saves: 0,
    async load() { return this.snapshot; },
    async save(snapshot) {
      this.saves += 1;
      if (fail) { fail = false; throw new Error('db unavailable'); }
      this.snapshot = structuredClone(snapshot);
    }
  };
  const brain = new AsyncBrainStore(persistence);
  await assert.rejects(() => brain.remember({ content: 'failed write', source: 'test' }), /db unavailable/);
  assert.equal((await brain.snapshot()).memories.length, 0);
  assert.equal((await brain.snapshot()).audit.length, 0);

  const memory = await brain.remember({ content: 'successful write', source: 'test' });
  const snapshot = await brain.snapshot();
  assert.equal(snapshot.memories.length, 1);
  assert.equal(snapshot.memories[0].id, memory.id);
  assert.equal(snapshot.audit.length, 1);
  assert.equal(await brain.verifyAudit(), true);
  assert.equal(persistence.saves, 2);
});
