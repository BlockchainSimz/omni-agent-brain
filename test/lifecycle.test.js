import test from 'node:test';
import assert from 'node:assert/strict';
import { freshness, lifecycleScore, findDuplicates, revalidationQueue, contentFingerprint } from '../src/lifecycle.js';

const base = { id: 'a', content: 'bounded retry policy for idempotent operations', confidence: 0.9, status: 'validated', createdAt: '2026-01-01T00:00:00.000Z' };

test('freshness decays over time', () => {
  const now = Date.parse('2026-01-31T00:00:00.000Z');
  const fresh = freshness(base, now, 30);
  assert.ok(fresh > 0.49 && fresh < 0.51);
  assert.ok(lifecycleScore(base, { now, halfLifeDays: 30 }) < base.confidence);
});

test('detects near duplicate memories', () => {
  const other = { id: 'b', content: 'bounded retry policy for idempotent operations with a budget', confidence: 0.8, status: 'candidate', createdAt: base.createdAt };
  const matches = findDuplicates([base, other], 0.65);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].primaryId, 'a');
});

test('queues stale memories for revalidation', () => {
  const stale = { ...base, id: 'stale', createdAt: '2025-01-01T00:00:00.000Z' };
  const queue = revalidationQueue([stale], { now: Date.parse('2026-01-01T00:00:00.000Z'), halfLifeDays: 30, staleThreshold: 0.35 });
  assert.equal(queue.length, 1);
  assert.equal(queue[0].memory.id, 'stale');
});

test('content fingerprints normalize equivalent text', () => {
  assert.equal(contentFingerprint(' Hello   World '), contentFingerprint('hello world'));
});
