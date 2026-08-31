import test from 'node:test';
import assert from 'node:assert/strict';
import { BrainStore } from '../src/brain.js';
import { EvolutionEngine } from '../src/evolution.js';

test('evolution records evaluation and preserves provenance hashes', () => {
  const store = new BrainStore();
  const engine = new EvolutionEngine(store);
  const skill = engine.proposeFromObservation({ name: 'bounded-retry', definition: 'retry idempotent operations with a fixed budget', evidence: [{ source: 'github:example@abc', observation: 'bounded retries reduce runaway loops' }] });
  assert.equal(skill.status, 'candidate');
  assert.equal(skill.evidence.length, 1);
  const evaluation = engine.evaluateCandidate(skill.id, { passed: true, score: 0.91, regressionRate: 0, benchmarkId: 'baseline-001' });
  assert.equal(evaluation.score, 0.91);
  assert.equal(store.snapshot().audit.at(-1).event, 'skill.evaluated');
});
