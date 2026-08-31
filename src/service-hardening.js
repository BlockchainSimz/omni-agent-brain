import crypto from 'node:crypto';

export function validateRequest(body, { required = [], maxBytes = 64 * 1024 } = {}) {
  const value = body ?? {};
  if (JSON.stringify(value).length > maxBytes) throw new Error('request_too_large');
  for (const field of required) {
    if (value[field] === undefined || value[field] === null || value[field] === '') throw new Error(`missing_required_field:${field}`);
  }
  return value;
}

export class RateLimiter {
  constructor({ limit = 60, windowMs = 60_000 } = {}) { this.limit = limit; this.windowMs = windowMs; this.entries = new Map(); }
  check(key) {
    if (!key) throw new Error('rate_limit_key_required');
    const now = Date.now();
    const entry = this.entries.get(key);
    if (!entry || now >= entry.resetAt) { this.entries.set(key, { count: 1, resetAt: now + this.windowMs }); return { allowed: true, remaining: this.limit - 1, resetAt: now + this.windowMs }; }
    if (entry.count >= this.limit) return { allowed: false, remaining: 0, resetAt: entry.resetAt };
    entry.count += 1;
    return { allowed: true, remaining: this.limit - entry.count, resetAt: entry.resetAt };
  }
}

export function createRequestContext(headers = {}) {
  return { requestId: headers['x-request-id'] || crypto.randomUUID(), receivedAt: new Date().toISOString() };
}

export function errorResponse(error, requestId) {
  const message = error?.message || 'internal_error';
  const status = message.startsWith('missing_required_field') || message === 'request_too_large' ? 400 : message === 'rate_limited' ? 429 : 500;
  return { status, body: { error: status === 500 ? 'internal_error' : message, requestId } };
}
