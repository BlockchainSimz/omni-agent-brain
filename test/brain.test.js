import test from 'node:test';
import assert from 'node:assert/strict';
import { BrainStore, sha256 } from '../src/brain.js';

test('stores provenance and hashes source', () => {
  const brain = new BrainStore();
  const item = brain.remember({ content: 'checkpoint state before execution', source: 'github:example@abc123', confidence: 0.9 });
  assert.equal(item.status, 'candidate');
  assert.equal(item.sourceHash, sha256('github:example@abc123'));
  assert.equal(brain.snapshot().audit[0].event, 'memory.created');
});

test('rejects failed memory validation', () => {
  const brain = new BrainStore();
  const item = brain.remember({ content: 'claim', source: 'test' });
  const result = brain.validateMemory(item.id, { passed: false, confidence: 0.1 });
  assert.equal(result.status, 'rejected');
});

test('blocks weak skill promotion and promotes passing skill', () => {
  const brain = new BrainStore();
  const skill = brain.proposeSkill({ name: 'safe-retry', definition: 'retry idempotent operations with a bounded budget' });
  assert.throws(() => brain.promoteSkill(skill.id, { passed: true, score: 0.7, regressionRate: 0 }), /score/);
  const promoted = brain.promoteSkill(skill.id, { passed: true, score: 0.92, regressionRate: 0 });
  assert.equal(promoted.status, 'promoted');
  assert.equal(promoted.version, 2);
});

test('blocks promotion when regressions exist and supports rollback', () => {
  const brain = new BrainStore();
  const skill = brain.proposeSkill({ name: 'test', definition: 'test' });
  assert.throws(() => brain.promoteSkill(skill.id, { passed: true, score: 0.95, regressionRate: 0.01 }), /regression/);
  const rolled = brain.rollbackSkill(skill.id, 'benchmark regression detected');
  assert.equal(rolled.status, 'deprecated');
});
