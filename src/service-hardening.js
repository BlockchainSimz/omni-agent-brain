import crypto from 'node:crypto';

export function validateHttpRequest({ method, headers = {} } = {}) {
  if (!['GET', 'POST'].includes(method)) {
    const error = new Error('method_not_allowed');
    error.statusCode = 405;
    throw error;
  }
  if (method === 'POST') {
    const contentType = String(headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
    if (contentType !== 'application/json') {
      const error = new Error('unsupported_media_type');
      error.statusCode = 415;
      throw error;
    }
  }
  return true;
}

export function validateRequest(body, { required = [], maxBytes = 64 * 1024 } = {}) {
  const value = body ?? {};
  if (JSON.stringify(value).length > maxBytes) throw new Error('request_too_large');
  for (const field of required) {
    if (value[field] === undefined || value[field] === null || value[field] === '') throw new Error(`missing_required_field:${field}`);
  }
  return value;
}

export class RateLimiter {
  constructor({ limit = 60, windowMs = 60_000, maxEntries = 10_000 } = {}) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('invalid_rate_limit');
    if (!Number.isFinite(windowMs) || windowMs < 1) throw new Error('invalid_rate_limit_window');
    if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new Error('invalid_rate_limit_entries');
    this.limit = limit;
    this.windowMs = windowMs;
    this.maxEntries = maxEntries;
    this.entries = new Map();
  }
  check(key) {
    if (!key) throw new Error('rate_limit_key_required');
    const now = Date.now();
    const entry = this.entries.get(key);
    if (!entry || now >= entry.resetAt) {
      this.entries.set(key, { count: 1, resetAt: now + this.windowMs });
      while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value);
      return { allowed: true, remaining: Math.max(0, this.limit - 1), resetAt: now + this.windowMs };
    }
    if (entry.count >= this.limit) return { allowed: false, remaining: 0, resetAt: entry.resetAt };
    entry.count += 1;
    return { allowed: true, remaining: this.limit - entry.count, resetAt: entry.resetAt };
  }
  clearExpired(now = Date.now()) {
    for (const [key, entry] of this.entries) if (entry.resetAt <= now) this.entries.delete(key);
  }
}

export class IdempotencyStore {
  constructor({ ttlMs = 10 * 60_000, maxEntries = 10_000 } = {}) {
    if (!Number.isFinite(ttlMs) || ttlMs < 1) throw new Error('invalid_idempotency_ttl');
    if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new Error('invalid_idempotency_entries');
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.entries = new Map();
  }
  async run(key, payload, operation) {
    if (!key || !/^[A-Za-z0-9._:-]{1,128}$/.test(key)) throw new Error('invalid_idempotency_key');
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify(payload ?? null)).digest('hex');
    const now = Date.now();
    const existing = this.entries.get(key);
    if (existing && now < existing.expiresAt) {
      if (existing.fingerprint !== fingerprint) { const error = new Error('idempotency_key_reused'); error.statusCode = 409; throw error; }
      return existing.promise;
    }
    if (existing) this.entries.delete(key);
    const promise = Promise.resolve().then(operation).then(result => {
      const current = this.entries.get(key);
      if (current?.promise === promise) current.result = result;
      return result;
    }).catch(error => {
      const current = this.entries.get(key);
      if (current?.promise === promise) this.entries.delete(key);
      throw error;
    });
    this.entries.set(key, { fingerprint, promise, expiresAt: now + this.ttlMs });
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value);
    return promise;
  }
  clearExpired(now = Date.now()) {
    for (const [key, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(key);
  }
}

export function createRequestContext(headers = {}) {
  const supplied = headers['x-request-id'];
  const requestId = typeof supplied === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(supplied) ? supplied : crypto.randomUUID();
  return { requestId, receivedAt: new Date().toISOString() };
}

export function errorResponse(error, requestId) {
  const message = error?.message || 'internal_error';
  const status = error?.statusCode || (message.startsWith('missing_required_field') || message === 'request_too_large' || message === 'invalid_idempotency_key' ? 400 : message === 'rate_limited' ? 429 : 500);
  return { status, body: { error: status === 500 ? 'internal_error' : message, requestId } };
}
