import test from 'node:test';
import assert from 'node:assert/strict';
import { BrainStore } from '../src/brain.js';
import { MemoryStoreManager, MEMORY_TYPES } from '../src/memory-stores.js';

function brain() {
  return new BrainStore({ load: () => null, save: () => {} });
}

test('separates episodic, semantic and procedural memories', () => {
  const manager = new MemoryStoreManager(brain());
  const episodic = manager.rememberEpisodic({ content: 'user completed a deployment', source: 'event-log' });
  const semantic = manager.rememberSemantic({ content: 'deployments require a health check', source: 'validated-doc' });
  const procedural = manager.rememberProcedural({ content: 'run health check before rollout', source: 'skill:release', skillId: 'skill-release' });

  assert.equal(episodic.type, MEMORY_TYPES.EPISODIC);
  assert.equal(semantic.type, MEMORY_TYPES.SEMANTIC);
  assert.equal(procedural.type, MEMORY_TYPES.PROCEDURAL);
  assert.equal(manager.list(MEMORY_TYPES.EPISODIC).length, 1);
  assert.equal(manager.list(MEMORY_TYPES.SEMANTIC).length, 1);
  assert.equal(manager.list(MEMORY_TYPES.PROCEDURAL).length, 1);
  assert.equal(manager.get(MEMORY_TYPES.PROCEDURAL, procedural.id).metadata.skillId, 'skill-release');
});

test('working memory expires deterministically and can be pruned', () => {
  let now = Date.parse('2026-01-01T00:00:00.000Z');
  const store = brain();
  const manager = new MemoryStoreManager(store, { clock: () => now });
  const item = manager.rememberWorking({ content: 'temporary execution context', source: 'runtime' }, { ttlMs: 1000 });

  assert.equal(manager.list(MEMORY_TYPES.WORKING).length, 1);
  now += 1001;
  assert.equal(manager.list(MEMORY_TYPES.WORKING).length, 0);
  assert.equal(manager.list(MEMORY_TYPES.WORKING, { includeExpired: true }).length, 1);
  assert.equal(manager.pruneWorking(), 1);
  assert.throws(() => store.requireMemory(item.id), /memory not found/);
});

test('rejects invalid procedural and working-memory configuration', () => {
  const manager = new MemoryStoreManager(brain());
  assert.throws(() => manager.rememberProcedural({ content: 'x', source: 'y' }), /skillId/);
  assert.throws(() => manager.rememberWorking({ content: 'x', source: 'y' }, { ttlMs: 0 }), /ttl/);
  assert.throws(() => manager.list('unknown'), /invalid_memory_type/);
});
