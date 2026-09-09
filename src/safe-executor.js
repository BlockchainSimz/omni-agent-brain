import crypto from 'node:crypto';

const DEFAULTS = Object.freeze({
  maxInputBytes: 32 * 1024,
  maxOutputBytes: 64 * 1024,
  maxSteps: 100,
  timeoutMs: 1_000
});

const ALLOWED_TOOLS = new Map([
  ['math.add', ({ a, b }) => finiteNumber(a) + finiteNumber(b)],
  ['math.subtract', ({ a, b }) => finiteNumber(a) - finiteNumber(b)],
  ['math.multiply', ({ a, b }) => finiteNumber(a) * finiteNumber(b)],
  ['math.divide', ({ a, b }) => { const divisor = finiteNumber(b); if (divisor === 0) throw new Error('division_by_zero'); return finiteNumber(a) / divisor; }],
  ['text.length', ({ value }) => boundedString(value).length],
  ['text.lowercase', ({ value }) => boundedString(value).toLowerCase()],
  ['text.uppercase', ({ value }) => boundedString(value).toUpperCase()],
  ['text.contains', ({ value, search }) => boundedString(value).includes(boundedString(search))],
  ['json.get', ({ value, path = [] }) => getPath(value, path)]
]);

function finiteNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error('invalid_number');
  return number;
}

function boundedString(value) {
  if (typeof value !== 'string' || value.length > 20_000) throw new Error('invalid_string');
  return value;
}

function getPath(value, path) {
  if (!Array.isArray(path) || path.length > 20 || path.some(part => typeof part !== 'string' && !Number.isInteger(part))) throw new Error('invalid_path');
  let current = value;
  for (const part of path) {
    if (current === null || current === undefined || (typeof current !== 'object' && !Array.isArray(current))) return null;
    if (typeof part === 'string' && (part === '__proto__' || part === 'prototype' || part === 'constructor')) throw new Error('forbidden_path');
    current = current[part];
  }
  return current === undefined ? null : structuredClone(current);
}

function byteLength(value) {
  return Buffer.byteLength(JSON.stringify(value));
}

function boundedOptions(options = {}) {
  const normalized = {
    maxInputBytes: Number.isInteger(options.maxInputBytes) ? options.maxInputBytes : DEFAULTS.maxInputBytes,
    maxOutputBytes: Number.isInteger(options.maxOutputBytes) ? options.maxOutputBytes : DEFAULTS.maxOutputBytes,
    maxSteps: Number.isInteger(options.maxSteps) ? options.maxSteps : DEFAULTS.maxSteps,
    timeoutMs: Number.isInteger(options.timeoutMs) ? options.timeoutMs : DEFAULTS.timeoutMs
  };
  if (normalized.maxInputBytes < 1 || normalized.maxInputBytes > DEFAULTS.maxInputBytes) throw new Error('invalid_max_input_bytes');
  if (normalized.maxOutputBytes < 1 || normalized.maxOutputBytes > DEFAULTS.maxOutputBytes) throw new Error('invalid_max_output_bytes');
  if (normalized.maxSteps < 1 || normalized.maxSteps > DEFAULTS.maxSteps) throw new Error('invalid_max_steps');
  if (normalized.timeoutMs < 1 || normalized.timeoutMs > DEFAULTS.timeoutMs) throw new Error('invalid_timeout');
  return normalized;
}

function normalizeCall(call) {
  if (!call || typeof call !== 'object' || Array.isArray(call)) throw new Error('invalid_tool_call');
  if (typeof call.tool !== 'string' || !ALLOWED_TOOLS.has(call.tool)) throw new Error(`tool_not_allowed:${call.tool || ''}`);
  const input = call.input === undefined ? {} : structuredClone(call.input);
  if (byteLength(input) > DEFAULTS.maxInputBytes) throw new Error('tool_input_too_large');
  return { tool: call.tool, input };
}

export class SafeToolExecutor {
  constructor(options = {}) {
    this.options = boundedOptions(options);
  }

  listTools() {
    return [...ALLOWED_TOOLS.keys()];
  }

  async execute(call, metadata = {}) {
    const startedAt = Date.now();
    const normalized = normalizeCall(call);
    const result = await this.#executeOne(normalized, this.options.timeoutMs);
    const output = structuredClone(result);
    if (byteLength(output) > this.options.maxOutputBytes) throw new Error('tool_output_too_large');
    return {
      executionId: crypto.randomUUID(),
      tool: normalized.tool,
      result: output,
      durationMs: Date.now() - startedAt,
      provenance: {
        executor: 'safe-tool-executor-v1',
        source: typeof metadata.source === 'string' ? metadata.source.slice(0, 200) : 'api'
      }
    };
  }

  async executeBatch(calls, metadata = {}) {
    if (!Array.isArray(calls) || calls.length < 1 || calls.length > this.options.maxSteps) throw new Error('invalid_tool_calls');
    const startedAt = Date.now();
    const results = [];
    for (const call of calls) {
      if (Date.now() - startedAt > this.options.timeoutMs) throw new Error('execution_timeout');
      results.push(await this.execute(call, metadata));
    }
    return { results, count: results.length, durationMs: Date.now() - startedAt };
  }

  #executeOne(call, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('execution_timeout')), timeoutMs);
      try {
        const result = ALLOWED_TOOLS.get(call.tool)(call.input);
        clearTimeout(timer);
        resolve(result);
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    });
  }
}

export { ALLOWED_TOOLS, DEFAULTS, getPath };
