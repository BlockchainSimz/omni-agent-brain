import test from 'node:test';
import assert from 'node:assert/strict';
import { SafeToolExecutor } from '../src/safe-executor.js';

test('safe executor exposes only allowlisted pure tools', async () => {
  const executor = new SafeToolExecutor();
  assert.deepEqual(executor.listTools(), [
    'math.add', 'math.subtract', 'math.multiply', 'math.divide',
    'text.length', 'text.lowercase', 'text.uppercase', 'text.contains', 'json.get'
  ]);
  const result = await executor.execute({ tool: 'math.add', input: { a: 2, b: 3 } }, { source: 'test' });
  assert.equal(result.result, 5);
  assert.equal(result.provenance.executor, 'safe-tool-executor-v1');
  assert.equal(result.provenance.source, 'test');
  assert.ok(result.executionId);
});

test('rejects arbitrary code, unknown tools and dangerous object paths', async () => {
  const executor = new SafeToolExecutor();
  await assert.rejects(() => executor.execute({ tool: 'node.exec', input: {} }), /tool_not_allowed/);
  await assert.rejects(() => executor.execute({ tool: 'eval', input: { code: '1 + 1' } }), /tool_not_allowed/);
  await assert.rejects(() => executor.execute({ tool: 'json.get', input: { value: {}, path: ['constructor'] } }), /forbidden_path/);
});

test('enforces bounded input, output and batch size', async () => {
  const executor = new SafeToolExecutor({ maxInputBytes: 100, maxOutputBytes: 100, maxSteps: 2 });
  await assert.rejects(() => executor.execute({ tool: 'text.length', input: { value: 'x'.repeat(101) } }), /tool_input_too_large/);
  await assert.rejects(() => executor.executeBatch([
    { tool: 'math.add', input: { a: 1, b: 2 } },
    { tool: 'math.add', input: { a: 2, b: 3 } },
    { tool: 'math.add', input: { a: 3, b: 4 } }
  ]), /invalid_tool_calls/);
});

test('supports deterministic pure transformations and batch provenance', async () => {
  const executor = new SafeToolExecutor();
  const batch = await executor.executeBatch([
    { tool: 'text.uppercase', input: { value: 'Omni' } },
    { tool: 'json.get', input: { value: { nested: { value: 42 } }, path: ['nested', 'value'] } }
  ], { source: 'evaluation' });
  assert.equal(batch.count, 2);
  assert.equal(batch.results[0].result, 'OMNI');
  assert.equal(batch.results[1].result, 42);
  assert.equal(batch.results[1].provenance.source, 'evaluation');
});

test('rejects invalid numeric operations', async () => {
  const executor = new SafeToolExecutor();
  await assert.rejects(() => executor.execute({ tool: 'math.divide', input: { a: 1, b: 0 } }), /division_by_zero/);
  await assert.rejects(() => executor.execute({ tool: 'math.add', input: { a: 'nope', b: 1 } }), /invalid_number/);
});
