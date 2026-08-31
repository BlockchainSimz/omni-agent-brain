import test from 'node:test';
import assert from 'node:assert/strict';
import { FeedbackEngine } from '../src/feedback.js';

function storeStub() { return { remember: input => ({ id: 'm1', ...input }) }; }

test('evaluates successful outcomes', () => {
  const feedback = new FeedbackEngine({ store: storeStub() });
  const result = feedback.evaluate({ decisionId: 'd1', executionId: 'e1', ok: true, score: 0.9 });
  assert.equal(result.passed, true);
});

test('does not learn from failed or untrusted outcomes', () => {
  const feedback = new FeedbackEngine({ store: storeStub() });
  const failed = feedback.evaluate({ decisionId: 'd1', ok: false, score: 1, trusted: true });
  const untrusted = feedback.evaluate({ decisionId: 'd2', ok: true, score: 1, trusted: false });
  assert.equal(feedback.learn(failed, { content: 'bad' }).learned, false);
  assert.equal(feedback.learn(untrusted, { content: 'untrusted' }).learned, false);
});

test('learns only from passed trusted outcomes', () => {
  const feedback = new FeedbackEngine({ store: storeStub() });
  const evaluation = feedback.evaluate({ decisionId: 'd1', ok: true, score: 0.95, trusted: true });
  const result = feedback.learn(evaluation, { content: 'validated execution result', source: 'execution' });
  assert.equal(result.learned, true);
  assert.equal(result.memory.id, 'm1');
});
