import test from 'node:test';
import assert from 'node:assert/strict';
import { ExecutionEngine, ExecutionPolicy } from '../src/execution.js';

test('denies capabilities by default', async () => {
  const engine = new ExecutionEngine(new ExecutionPolicy());
  const result = await engine.execute('shell', {});
  assert.equal(result.ok, false);
  assert.match(result.error, /not permitted/);
});

test('executes only explicitly enabled capability', async () => {
  const events = [];
  const policy = new ExecutionPolicy({ echo: { enabled: true, execute: async input => ({ value: input.value }) } });
  const result = await new ExecutionEngine(policy, { audit: event => events.push(event) }).execute('echo', { value: 'ok' });
  assert.deepEqual(result.result, { value: 'ok' });
  assert.equal(events[0].ok, true);
});

test('enforces timeout', async () => {
  const policy = new ExecutionPolicy({ slow: { enabled: true, execute: async () => new Promise(resolve => setTimeout(() => resolve('late'), 50)) } });
  const result = await new ExecutionEngine(policy, { timeoutMs: 5 }).execute('slow');
  assert.equal(result.ok, false);
  assert.equal(result.error, 'execution_timeout');
});

test('enforces output limit', async () => {
  const policy = new ExecutionPolicy({ large: { enabled: true, execute: async () => '123456789' } });
  const result = await new ExecutionEngine(policy, { maxOutputBytes: 4 }).execute('large');
  assert.equal(result.ok, false);
  assert.match(result.error, /output exceeds/);
});
