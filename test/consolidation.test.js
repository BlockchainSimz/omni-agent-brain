import test from 'node:test';
import assert from 'node:assert/strict';
import { consolidate, detectConflicts } from '../src/consolidation.js';

const memory = (id, content, topic = 'retry', confidence = 0.8) => ({ id, content, topic, confidence, status: 'validated', source: `source:${id}`, sourceHash: `hash:${id}` });

test('consolidates equivalent knowledge while retaining provenance', () => {
  const result = consolidate([memory('a', 'Use bounded retries.'), memory('b', ' use bounded   retries. ') ]);
  assert.equal(result.groups.length, 1);
  assert.deepEqual(result.groups[0].sourceMemoryIds.sort(), ['a', 'b']);
  assert.equal(result.groups[0].provenance.length, 2);
});

test('detects distinct claims on the same topic', () => {
  const result = detectConflicts([memory('a', 'Retry three times.'), memory('b', 'Never retry.', 'retry')]);
  assert.equal(result.length, 1);
  assert.equal(result[0].requiresValidation, true);
});

test('ignores rejected knowledge during conflict analysis', () => {
  const rejected = { ...memory('b', 'Never retry.'), status: 'rejected' };
  assert.equal(detectConflicts([memory('a', 'Retry three times.'), rejected]).length, 0);
});
