export class SharedRateLimiter {
  constructor({ backend, limit = 60, windowMs = 60_000 } = {}) {
    if (!backend || typeof backend.increment !== 'function') throw new Error('invalid_rate_limit_backend');
    if (!Number.isInteger(limit) || limit < 1) throw new Error('invalid_rate_limit');
    if (!Number.isFinite(windowMs) || windowMs < 1) throw new Error('invalid_rate_limit_window');
    this.backend = backend;
    this.limit = limit;
    this.windowMs = windowMs;
  }

  async check(key) {
    if (!key) throw new Error('rate_limit_key_required');
    const result = await this.backend.increment(key, this.windowMs);
    const count = Number(result?.count);
    const resetAt = Number(result?.resetAt);
    if (!Number.isFinite(count) || !Number.isFinite(resetAt)) throw new Error('invalid_rate_limit_backend_response');
    return { allowed: count <= this.limit, remaining: Math.max(0, this.limit - count), resetAt };
  }
}

export class InMemorySharedRateLimitBackend {
  constructor({ maxEntries = 10_000 } = {}) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new Error('invalid_rate_limit_entries');
    this.maxEntries = maxEntries;
    this.entries = new Map();
  }

  async increment(key, windowMs) {
    const now = Date.now();
    const current = this.entries.get(key);
    if (!current || current.resetAt <= now) {
      const entry = { count: 1, resetAt: now + windowMs };
      this.entries.set(key, entry);
      this.#trim();
      return entry;
    }
    current.count += 1;
    return current;
  }

  #trim() {
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value);
  }
}
