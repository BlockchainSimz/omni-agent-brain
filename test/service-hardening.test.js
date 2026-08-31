import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRequest, RateLimiter, createRequestContext, errorResponse } from '../src/service-hardening.js';

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

test('request context preserves trusted correlation header and errors expose request id only', () => {
  const context = createRequestContext({ 'x-request-id': 'req-1' });
  assert.equal(context.requestId, 'req-1');
  const response = errorResponse(new Error('database secret'), context.requestId);
  assert.equal(response.status, 500);
  assert.equal(response.body.error, 'internal_error');
  assert.equal(response.body.requestId, 'req-1');
});
