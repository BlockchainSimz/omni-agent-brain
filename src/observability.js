import crypto from 'node:crypto';

export class Metrics {
  constructor({ maxTimingSamples = 10_000 } = {}) {
    if (!Number.isInteger(maxTimingSamples) || maxTimingSamples < 1) throw new Error('invalid_metric_samples');
    this.maxTimingSamples = maxTimingSamples;
    this.counters = new Map();
    this.timings = new Map();
  }
  increment(name, value = 1) { this.counters.set(name, (this.counters.get(name) || 0) + value); }
  observe(name, value) {
    if (!Number.isFinite(value)) throw new Error('metric value must be finite');
    const values = this.timings.get(name) || [];
    values.push(value);
    if (values.length > this.maxTimingSamples) values.splice(0, values.length - this.maxTimingSamples);
    this.timings.set(name, values);
  }
  snapshot() {
    const timing = {};
    for (const [name, values] of this.timings) timing[name] = {
      count: values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      avg: values.reduce((a, b) => a + b, 0) / values.length
    };
    return { counters: Object.fromEntries(this.counters), timings: timing };
  }
}

export class StructuredLogger {
  constructor({ sink = console } = {}) { this.sink = sink; }
  log(level, message, context = {}) { const event = { timestamp: new Date().toISOString(), level, message, correlationId: context.correlationId || crypto.randomUUID(), ...context }; const method = typeof this.sink[level] === 'function' ? level : 'log'; this.sink[method](JSON.stringify(event)); return event; }
}

export function healthSnapshot({ ready = true, dependencies = {} } = {}) {
  const dependencyValues = Object.values(dependencies);
  const healthy = ready && dependencyValues.every(value => value === true);
  return { status: healthy ? 'ok' : 'degraded', ready: Boolean(ready), dependencies: { ...dependencies }, timestamp: new Date().toISOString() };
}
