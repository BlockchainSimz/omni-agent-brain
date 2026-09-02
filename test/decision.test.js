import test from 'node:test';
import assert from 'node:assert/strict';
import { DecisionEngine } from '../src/decision.js';

function setup(rule = { enabled: true, execute: async input => ({ ok: input.value }) }) {
  const policy = { authorize: () => rule };
  const execution = { execute: async (capability, input) => ({ ok: true, result: await rule.execute(input), executionId: 'exec-1' }) };
  const events = [];
  return { engine: new DecisionEngine({ policy, execution, audit: e => events.push(e), minConfidence: 0.7 }), events };
}

test('rejects low confidence decisions', () => {
  const { engine } = setup();
  const proposal = engine.propose({ capability: 'echo', confidence: 0.4 });
  assert.equal(proposal.status, 'rejected_low_confidence');
});

test('creates pending proposal above confidence threshold', () => {
  const { engine } = setup();
  const proposal = engine.propose({ capability: 'echo', confidence: 0.9, rationale: 'validated evidence' });
  assert.equal(proposal.status, 'pending_policy');
  assert.ok(proposal.id);
});

test('requires explicit approval when policy demands it', async () => {
  const { engine } = setup({ enabled: true, approvalRequired: true, execute: async () => 'ok' });
  const proposal = engine.propose({ capability: 'echo', confidence: 0.9 });
  await assert.rejects(() => engine.execute(proposal), /explicit approval required/);
});

test('executes approved-by-policy proposal and records completion', async () => {
  const { engine, events } = setup();
  const proposal = engine.propose({ capability: 'echo', confidence: 0.9, input: { value: 'yes' } });
  const outcome = await engine.execute(proposal);
  assert.equal(outcome.result.ok, true);
  assert.equal(events.at(-1).type, 'decision.completed');
});
