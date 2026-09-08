import test from 'node:test';
import assert from 'node:assert/strict';
import { BrainStore, MemoryPersistence } from '../src/brain.js';

test('brain persists vector embeddings and retrieves relevant memories', () => {
  const persistence = new MemoryPersistence();
  const brain = new BrainStore(persistence);
  brain.remember({ content: 'Use bounded retries for idempotent API requests', source: 'engineering guide', confidence: 1 });
  brain.remember({ content: 'Mountain hiking checklist for a weekend trail', source: 'travel notes', confidence: 1 });

  const results = brain.searchMemories('API retry strategy', { limit: 2 });
  assert.equal(results[0].content, 'Use bounded retries for idempotent API requests');
  assert.ok(results[0].score > results[1].score);
  assert.equal(results[0].embedding.length, 256);

  const reloaded = new BrainStore(persistence);
  const reloadedResults = reloaded.searchMemories('API retry strategy', { limit: 1 });
  assert.equal(reloadedResults[0].id, results[0].id);
});

test('brain vector retrieval excludes rejected and deprecated memories', () => {
  const brain = new BrainStore(new MemoryPersistence());
  const rejected = brain.remember({ content: 'API security guidance', source: 'test', confidence: 1 });
  brain.validateMemory(rejected.id, { passed: false });
  const deprecated = brain.remember({ content: 'API security guidance', source: 'old test', confidence: 1 });
  brain.validateMemory(deprecated.id, { passed: true });
  const skill = brain.proposeSkill({ name: 'test-skill', definition: 'test' });
  brain.promoteSkill(skill.id, { passed: true, score: 0.9, regressionRate: 0 });
  brain.rollbackSkill(skill.id, 'replaced');

  const results = brain.searchMemories('API security guidance', { limit: 10 });
  assert.equal(results.some(item => item.id === rejected.id), false);
  assert.equal(results.some(item => item.id === deprecated.id), true);
});
