import test from 'node:test';
import assert from 'node:assert/strict';
import { BrainStore } from '../src/brain.js';

test('redacts secret-like metadata keys', () => {
  const store = new BrainStore();
  const item = store.remember({ content: 'safe observation', source: 'trusted:test', metadata: { apiKey: 'do-not-store', token: 'secret', category: 'test' } });
  assert.equal(item.metadata.apiKey, '[REDACTED]');
  assert.equal(item.metadata.token, '[REDACTED]');
  assert.equal(item.metadata.category, 'test');
});

test('audit chain verifies after lifecycle events', () => {
  const store = new BrainStore();
  const memory = store.remember({ content: 'claim', source: 'test' });
  store.validateMemory(memory.id, { passed: true, confidence: 0.9 });
  const skill = store.proposeSkill({ name: 'skill', definition: 'definition' });
  store.promoteSkill(skill.id, { passed: true, score: 0.9, regressionRate: 0 });
  assert.equal(store.verifyAudit(), true);
});
