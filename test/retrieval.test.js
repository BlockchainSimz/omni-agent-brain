import test from 'node:test';
import assert from 'node:assert/strict';
import { retrieveMemories } from '../src/retrieval.js';

test('ranks relevant memories above unrelated memories', () => {
  const memories = [
    { id: '1', content: 'bounded retries for idempotent API requests', source: 'docs', confidence: 1, status: 'validated', createdAt: '2026-01-01T00:00:00.000Z' },
    { id: '2', content: 'mountain hiking checklist', source: 'notes', confidence: 1, status: 'validated', createdAt: '2026-01-02T00:00:00.000Z' }
  ];
  const results = retrieveMemories(memories, 'API retry strategy', { limit: 2 });
  assert.equal(results[0].id, '1');
  assert.ok(results[0].score > 0);
});

test('excludes rejected memories and respects limit', () => {
  const memories = Array.from({ length: 3 }, (_, i) => ({ id: String(i), content: 'agent memory retrieval', source: 'test', confidence: 1, status: i === 2 ? 'rejected' : 'validated', createdAt: `2026-01-0${i + 1}T00:00:00.000Z` }));
  const results = retrieveMemories(memories, 'agent memory', { limit: 1 });
  assert.equal(results.length, 1);
  assert.notEqual(results[0].id, '2');
});
