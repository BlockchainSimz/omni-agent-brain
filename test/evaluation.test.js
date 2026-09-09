import test from 'node:test';
import assert from 'node:assert/strict';
import { EvaluationService, scoreCase } from '../src/evaluation.js';

test('evaluation service produces deterministic dataset hashes and scores', () => {
  const service = new EvaluationService({ datasets: [{
    id: 'core',
    version: '1',
    cases: [
      { id: 'exact', input: { value: 2 }, expected: { matcher: 'exact', value: { answer: 2 } } },
      { id: 'contains', input: 'hello', expected: { matcher: 'contains', value: 'ell' } },
      { id: 'numeric', input: 3, expected: { matcher: 'numeric', value: 3, tolerance: 0.01 } }
    ]
  }] });
  const dataset = service.get('core');
  const first = service.run(dataset, { exact: { answer: 2 }, contains: 'hello world', numeric: 3 });
  const second = service.run(dataset, { exact: { answer: 2 }, contains: 'hello world', numeric: 3 });
  assert.equal(first.score, 1);
  assert.equal(first.passed, true);
  assert.equal(first.regressionRate, 0);
  assert.equal(first.evaluationId, second.evaluationId);
  assert.equal(dataset.hash, service.get('core').hash);
});

test('evaluation detects baseline regressions', () => {
  const service = new EvaluationService({ datasets: [{ id: 'regression', version: '1', cases: [
    { id: 'a', input: 'a', expected: { matcher: 'exact', value: 'ok' } },
    { id: 'b', input: 'b', expected: { matcher: 'exact', value: 'ok' } }
  ] }] });
  const result = service.run('regression', { a: 'wrong', b: 'ok' }, { baseline: { a: 'ok', b: 'ok' } });
  assert.equal(result.score, 0.5);
  assert.equal(result.regressions, 1);
  assert.equal(result.regressionRate, 0.5);
  assert.equal(result.passed, false);
});

test('evaluation rejects unsupported matchers', () => {
  assert.throws(() => scoreCase({ matcher: 'unknown', value: 'x' }, 'x'), /unsupported_matcher/);
});
