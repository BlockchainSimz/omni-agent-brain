import test from 'node:test';
import assert from 'node:assert/strict';
import { backoffDelay, isRetryable, recoverStaleExecutions, retry } from '../src/reliability.js';

test('classifies only known transient failures as retryable', () => {
  assert.equal(isRetryable({ code: 'ECONNRESET' }), true);
  assert.equal(isRetryable({ code: 'EACCES' }), false);
});

test('retries transient failures with bounded attempts', async () => {
  let attempts = 0;
  const sleeps = [];
  const result = await retry(async attempt => {
    attempts = attempt;
    if (attempt < 3) throw Object.assign(new Error('temporary'), { code: 'ECONNRESET' });
    return 'ok';
  }, { maxAttempts: 3, delay: attempt => backoffDelay(attempt, { baseMs: 1, maxMs: 4, jitter: 0 }), sleep: ms => sleeps.push(ms) });
  assert.equal(result, 'ok');
  assert.equal(attempts, 3);
  assert.deepEqual(sleeps, [1, 2]);
});

test('does not retry non-transient failures', async () => {
  let attempts = 0;
  await assert.rejects(() => retry(async () => { attempts += 1; throw Object.assign(new Error('denied'), { code: 'EACCES' }); }, { maxAttempts: 5, sleep: async () => {} }));
  assert.equal(attempts, 1);
});

test('marks stale running executions for recovery', () => {
  const now = Date.parse('2026-08-31T12:00:00.000Z');
  const result = recoverStaleExecutions([
    { id: 'stale', status: 'running', startedAt: '2026-08-31T11:00:00.000Z' },
    { id: 'fresh', status: 'running', startedAt: '2026-08-31T11:59:30.000Z' },
    { id: 'done', status: 'completed', startedAt: '2026-08-31T10:00:00.000Z' }
  ], { now, staleAfterMs: 60_000 });
  assert.equal(result[0].status, 'recovery_required');
  assert.equal(result[1].status, 'running');
  assert.equal(result[2].status, 'completed');
});
