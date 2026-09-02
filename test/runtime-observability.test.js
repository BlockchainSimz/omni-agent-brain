import test from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeObservability } from '../src/runtime-observability.js';
import { Metrics } from '../src/observability.js';

test('runtime observability correlates lifecycle and records metrics', () => {
  const metrics = new Metrics();
  const events = [];
  const runtime = new RuntimeObservability({ metrics, logger: { log: (_level, _message, context) => { events.push(context); return context; } } });
  const operation = runtime.start({ correlationId: 'corr-1' });
  const completed = runtime.complete(operation);
  assert.equal(completed.correlationId, 'corr-1');
  assert.equal(completed.status, 'success');
  assert.equal(metrics.snapshot().counters['runtime.operations.success'], 1);
  assert.equal(events[0].correlationId, 'corr-1');
});

test('runtime health reflects dependencies', () => {
  const runtime = new RuntimeObservability({ dependencies: { database: true, audit: false } });
  assert.equal(runtime.health().status, 'degraded');
});
