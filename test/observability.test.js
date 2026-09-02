import test from 'node:test';
import assert from 'node:assert/strict';
import { Metrics, StructuredLogger, healthSnapshot } from '../src/observability.js';

test('metrics aggregate counters and timings', () => {
  const metrics = new Metrics();
  metrics.increment('executions'); metrics.increment('executions', 2); metrics.observe('latency', 10); metrics.observe('latency', 20);
  const snapshot = metrics.snapshot();
  assert.equal(snapshot.counters.executions, 3);
  assert.equal(snapshot.timings.latency.avg, 15);
});

test('metrics bound timing samples under sustained load', () => {
  const metrics = new Metrics({ maxTimingSamples: 3 });
  metrics.observe('latency', 10); metrics.observe('latency', 20); metrics.observe('latency', 30); metrics.observe('latency', 40);
  const snapshot = metrics.snapshot();
  assert.equal(snapshot.timings.latency.count, 3);
  assert.equal(snapshot.timings.latency.min, 20);
  assert.equal(snapshot.timings.latency.max, 40);
  assert.equal(snapshot.timings.latency.avg, 30);
});

test('metrics validate timing sample limits', () => {
  assert.throws(() => new Metrics({ maxTimingSamples: 0 }), /invalid_metric_samples/);
});

test('logger emits correlation id and structured context', () => {
  const events = []; const logger = new StructuredLogger({ sink: { log: value => events.push(JSON.parse(value)) } });
  const event = logger.log('info', 'decision completed', { correlationId: 'c1', decisionId: 'd1' });
  assert.equal(event.correlationId, 'c1'); assert.equal(events[0].decisionId, 'd1');
});

test('health reports degraded dependencies', () => {
  assert.equal(healthSnapshot({ dependencies: { database: true, audit: false } }).status, 'degraded');
  assert.equal(healthSnapshot({ dependencies: { database: true, audit: true } }).status, 'ok');
});
