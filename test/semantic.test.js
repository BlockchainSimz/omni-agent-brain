import test from 'node:test';
import assert from 'node:assert/strict';
import { SemanticIndex } from '../src/semantic.js';

test('lexical fallback ranks matching memories and filters inactive state', async () => {
  const index = new SemanticIndex();
  const memories = [
    { id: '1', content: 'database caching strategy', confidence: 0.9, status: 'validated' },
    { id: '2', content: 'unrelated deployment note', confidence: 0.9, status: 'validated' },
    { id: '3', content: 'database caching deprecated', confidence: 1, status: 'deprecated' }
  ];
  const result = await index.search(memories, 'database caching', 2);
  assert.equal(result[0].memory.id, '1');
  assert.equal(result.some(x => x.memory.id === '3'), false);
});

test('embedding adapter ranks by cosine similarity', async () => {
  const embedder = { embed: async text => text === 'query' ? [1, 0] : text === 'near' ? [0.9, 0.1] : [0, 1] };
  const index = new SemanticIndex(embedder);
  const memories = [
    { id: 'near', content: 'near', confidence: 0.5, status: 'validated' },
    { id: 'far', content: 'far', confidence: 1, status: 'validated' }
  ];
  await index.add(memories[0]); await index.add(memories[1]);
  const result = await index.search(memories, 'query', 2);
  assert.equal(result[0].memory.id, 'near');
});
