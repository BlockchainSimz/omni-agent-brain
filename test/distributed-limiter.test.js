import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemorySharedRateLimitBackend, SharedRateLimiter } from '../src/distributed-limiter.js';

test('shared rate limiter enforces a backend-backed window', async () => {
  const backend = new InMemorySharedRateLimitBackend();
  const limiter = new SharedRateLimiter({ backend, limit: 2, windowMs: 60_000 });
  const first = await limiter.check('client-a');
  const second = await limiter.check('client-a');
  const blocked = await limiter.check('client-a');
  assert.equal(first.allowed, true);
  assert.equal(first.remaining, 1);
  assert.equal(second.allowed, true);
  assert.equal(second.remaining, 0);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  assert.equal(Number.isFinite(first.resetAt), true);
});

test('shared rate limiter validates backend responses', async () => {
  const limiter = new SharedRateLimiter({ backend: { increment: async () => ({ count: 'bad', resetAt: 1 }) } });
  await assert.rejects(() => limiter.check('client-a'), /invalid_rate_limit_backend_response/);
});
