import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRequest, RateLimiter, IdempotencyStore, createRequestContext, errorResponse } from '../src/service-hardening.js';

test('request validation rejects missing and oversized payloads', () => {
  assert.throws(() => validateRequest({}, { required: ['input'] }), /missing_required_field/);
  assert.throws(() => validateRequest({ input: 'x'.repeat(100) }, { maxBytes: 20 }), /request_too_large/);
});

test('rate limiter bounds requests per window', () => {
  const limiter = new RateLimiter({ limit: 2, windowMs: 1000 });
  assert.equal(limiter.check('client').allowed, true);
  assert.equal(limiter.check('client').allowed, true);
  assert.equal(limiter.check('client').allowed, false);
});

test('idempotency reuses a successful in-flight operation', async () => {
  const store = new IdempotencyStore({ ttlMs: 1000 });
  let calls = 0;
  const operation = () => { calls += 1; return new Promise(resolve => setTimeout(() => resolve({ ok: true, calls }), 5)); };
  const [a, b] = await Promise.all([store.run('abc', { value: 1 }, operation), store.run('abc', { value: 1 }, operation)]);
  assert.deepEqual(a, b);
  assert.equal(calls, 1);
});

test('idempotency rejects reuse with a different payload', async () => {
  const store = new IdempotencyStore({ ttlMs: 1000 });
  await store.run('abc', { value: 1 }, () => 'first');
  await assert.rejects(() => store.run('abc', { value: 2 }, () => 'second'), error => error.statusCode === 409 && error.message === 'idempotency_key_reused');
});

test('idempotency removes failed operations so callers may retry', async () => {
  const store = new IdempotencyStore({ ttlMs: 1000 });
  await assert.rejects(() => store.run('abc', { value: 1 }, () => { throw new Error('temporary'); }), /temporary/);
  assert.equal(await store.run('abc', { value: 1 }, () => 'retry'), 'retry');
});

test('request context validates correlation ids and errors expose request id only', () => {
  const context = createRequestContext({ 'x-request-id': 'req-1' });
  assert.equal(context.requestId, 'req-1');
  assert.notEqual(createRequestContext({ 'x-request-id': 'bad id' }).requestId, 'bad id');
  const response = errorResponse(new Error('database secret'), context.requestId);
  assert.equal(response.status, 500);
  assert.equal(response.body.error, 'internal_error');
  assert.equal(response.body.requestId, 'req-1');
});
