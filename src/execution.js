import crypto from 'node:crypto';

export class ExecutionPolicy {
  constructor(capabilities = {}) { this.capabilities = new Map(Object.entries(capabilities)); }
  authorize(name, input = {}) {
    const rule = this.capabilities.get(name);
    if (!rule || rule.enabled !== true) throw new Error(`capability not permitted: ${name}`);
    if (rule.validate && !rule.validate(input)) throw new Error(`capability input rejected: ${name}`);
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
    let rule;
    try {
      rule = this.policy.authorize(name, input);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const result = await rule.execute(input, { signal: controller.signal, executionId });
        const serialized = JSON.stringify(result ?? null);
        if (Buffer.byteLength(serialized, 'utf8') > this.maxOutputBytes) throw new Error('tool output exceeds configured limit');
        const response = { executionId, ok: true, result, durationMs: Date.now() - startedAt };
        this.audit({ type: 'tool.executed', executionId, capability: name, ok: true, durationMs: response.durationMs });
        return response;
      } finally { clearTimeout(timer); }
    } catch (error) {
      const response = { executionId, ok: false, error: error.name === 'AbortError' ? 'execution_timeout' : error.message, durationMs: Date.now() - startedAt };
      this.audit({ type: 'tool.executed', executionId, capability: name, ok: false, error: response.error, durationMs: response.durationMs });
      return response;
    }
  }
}
