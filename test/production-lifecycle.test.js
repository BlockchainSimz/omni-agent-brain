import test from 'node:test';
import assert from 'node:assert/strict';
import { FreshnessScheduler } from '../src/freshness.js';
import { ApprovalService } from '../src/approval.js';
import { EmbeddingRegistry, localEmbeddingProvider } from '../src/embedding-lifecycle.js';

test('freshness scheduler plans stale memories and records execution', async () => {
  const now = Date.parse('2026-01-31T00:00:00Z');
  const store = { async snapshot() { return { memories: [{ id: 'm1', content: 'old', confidence: 0.1, status: 'validated', createdAt: '2025-01-01T00:00:00Z' }] }; } };
  const scheduler = new FreshnessScheduler({ store, now: () => now, halfLifeDays: 30, staleThreshold: 0.5, maxBatch: 10 });
  const plan = await scheduler.plan();
  assert.equal(plan.candidates.length, 1);
  const result = await scheduler.run();
  assert.equal(result.failed, 0);
  assert.ok(scheduler.status().lastRunAt);
});

test('approval service requires explicit approval before consumption', () => {
  const approvals = new ApprovalService({ requiredApprovals: 2, clock: () => 1000 });
  const request = approvals.request({ action: 'promote_skill', target: 'skill-1' });
  assert.throws(() => approvals.consume(request.id), /approval_required/);
  approvals.approve(request.id, 'reviewer-a');
  assert.throws(() => approvals.consume(request.id), /approval_required/);
  approvals.approve(request.id, 'reviewer-b');
  assert.equal(approvals.consume(request.id).status, 'consumed');
});

test('embedding registry exposes provider metadata and detects lifecycle drift', async () => {
  const registry = new EmbeddingRegistry({ providers: [localEmbeddingProvider] });
  const result = await registry.embed('hello world');
  assert.equal(result.dimensions, 256);
  assert.equal(registry.needsReindex(result), false);
  assert.equal(registry.needsReindex({ provider: 'old', version: '1', dimensions: 256 }), true);
});
