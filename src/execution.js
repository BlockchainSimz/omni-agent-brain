import crypto from 'node:crypto';

export class ExecutionPolicy {
  constructor(capabilities = {}) { this.capabilities = new Map(Object.entries(capabilities)); }
  authorize(name, input = {}) {
    const rule = this.capabilities.get(name);
    if (!rule || rule.enabled !== true) throw new Error(`capability not permitted: ${name}`);
    if (rule.validate && !rule.validate(input)) throw new Error(`capability input rejected: ${name}`);
    if (typeof rule.execute !== 'function') throw new Error(`capability has no executor: ${name}`);
    return rule;
  }
}

export class ExecutionEngine {
  constructor(policy, options = {}) {
    this.policy = policy;
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.maxOutputBytes = options.maxOutputBytes ?? 256_000;
    this.audit = options.audit || (() => {});
  }

  async execute(name, input = {}) {
    const executionId = crypto.randomUUID();
    const startedAt = Date.now();
    try {
      const rule = this.policy.authorize(name, input);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error('execution_timeout')), this.timeoutMs);
      const task = Promise.resolve().then(() => rule.execute(input, { signal: controller.signal, executionId }));
      try {
        const result = await Promise.race([
          task,
          new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason || new Error('execution_timeout')), { once: true }))
        ]);
        const serialized = JSON.stringify(result ?? null);
        if (Buffer.byteLength(serialized, 'utf8') > this.maxOutputBytes) throw new Error('tool output exceeds configured limit');
        const response = { executionId, ok: true, result, durationMs: Date.now() - startedAt };
        this.audit({ type: 'tool.executed', executionId, capability: name, ok: true, durationMs: response.durationMs });
        return response;
      } finally { clearTimeout(timer); }
    } catch (error) {
      const isTimeout = error?.message === 'execution_timeout' || error?.name === 'AbortError';
      const response = { executionId, ok: false, error: isTimeout ? 'execution_timeout' : error.message, durationMs: Date.now() - startedAt };
      this.audit({ type: 'tool.executed', executionId, capability: name, ok: false, error: response.error, durationMs: response.durationMs });
      return response;
    }
  }
}
