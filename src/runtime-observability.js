import crypto from 'node:crypto';
import { Metrics, StructuredLogger, healthSnapshot } from './observability.js';

export class RuntimeObservability {
  constructor({ metrics = new Metrics(), logger = new StructuredLogger(), dependencies = {} } = {}) {
    this.metrics = metrics;
    this.logger = logger;
    this.dependencies = dependencies;
  }

  start(context = {}) {
    const correlationId = context.correlationId || crypto.randomUUID();
    this.metrics.increment('runtime.operations.started');
    return { correlationId, startedAt: Date.now() };
  }

  complete(operation, { status = 'success', error } = {}) {
    const durationMs = Date.now() - operation.startedAt;
    this.metrics.increment(`runtime.operations.${status}`);
    this.metrics.observe('runtime.operation.duration_ms', durationMs);
    this.logger.log(status === 'success' ? 'info' : 'error', 'runtime operation completed', {
      correlationId: operation.correlationId,
      status,
      durationMs,
      error: error ? String(error.message || error) : undefined
    });
    return { ...operation, status, durationMs };
  }

  health() { return healthSnapshot({ ready: true, dependencies: this.dependencies }); }
}
