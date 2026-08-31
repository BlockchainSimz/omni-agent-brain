import test from 'node:test';
import assert from 'node:assert/strict';
import { BrainStore } from '../src/brain.js';
import { LearningPipeline } from '../src/learning.js';

function memoryStore() {
  return new BrainStore({ load: () => null, save: () => {} });
}

test('ingestion applies source trust and provenance', () => {
  const store = memoryStore();
  const pipeline = new LearningPipeline(store);
  const result = pipeline.ingest({ name: 'official-docs', type: 'documentation', trust: 'official', confidence: 0.9, content: 'Validated architecture guidance.' });
  assert.equal(result.memory.status, 'candidate');
  assert.equal(result.memory.metadata.trust, 1);
  assert.ok(result.memory.metadata.sourceId);
});

test('skills require validated memory evidence', () => {
  const store = memoryStore();
  const pipeline = new LearningPipeline(store);
  const result = pipeline.ingest({ url: 'https://example.test', trust: 'verified', content: 'A useful observation.' });
  assert.throws(() => pipeline.proposeSkillFromMemory(result.memory.id, { name: 'x', definition: 'y' }), /validated memories/);
  pipeline.evaluateMemory(result.memory.id, { passed: true, confidence: 0.95 });
  const skill = pipeline.proposeSkillFromMemory(result.memory.id, { name: 'x', definition: 'y' });
  assert.equal(skill.evidence[0].memoryId, result.memory.id);
});
