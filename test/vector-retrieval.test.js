import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmbedding, cosineSimilarity, DEFAULT_EMBEDDING_DIMENSIONS } from '../src/embeddings.js';
import { VectorIndex } from '../src/vector-retrieval.js';

test('embeddings are deterministic, normalized, and fixed-width', () => {
  const first = createEmbedding('API retry strategy for idempotent requests');
  const second = createEmbedding('API retry strategy for idempotent requests');
  assert.equal(first.length, DEFAULT_EMBEDDING_DIMENSIONS);
  assert.deepEqual(first, second);
  assert.ok(Math.abs(cosineSimilarity(first, first) - 1) < 1e-9);
});

test('vector index ranks semantically related text above unrelated text', () => {
  const index = new VectorIndex();
  index.upsert('api', 'bounded retries for idempotent API requests');
  index.upsert('hiking', 'mountain hiking checklist and river trail notes');
  const results = index.search('API retry strategy', 2);
  assert.equal(results[0].id, 'api');
  assert.ok(results[0].score > results[1].score);
});

test('vector index supports replacement and removal', () => {
  const index = new VectorIndex();
  index.upsert('one', 'first value');
  index.upsert('one', 'updated value');
  assert.equal(index.entries.size, 1);
  index.remove('one');
  assert.equal(index.entries.size, 0);
});
