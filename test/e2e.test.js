import test from 'node:test';
import assert from 'node:assert/strict';
import { ExecutionEngine, ExecutionPolicy } from '../src/execution.js';
import { CapabilityRegistry, AuditLog } from '../src/governance.js';
import { FeedbackEngine } from '../src/feedback.js';
import { DecisionEngine } from '../src/decision.js';

test('complete controlled decision-execution-feedback loop', async () => {
  const audit = new AuditLog();
  const memories = [];
  const store = { remember: input => { const memory = { id: `m${memories.length + 1}`, ...input }; memories.push(memory); return memory; } };
  const registry = new CapabilityRegistry({ lookup: { version: '1.0.0', enabled: true, execute: async input => ({ answer: `result:${input.query}` }) } });
  const policy = new ExecutionPolicy({ lookup: { enabled: true, execute: registry.get('lookup').execute } });
  const executor = new ExecutionEngine(policy, { audit: event => audit.append(event) });
  const decisions = new DecisionEngine({ executor, audit: event => audit.append(event), minConfidence: 0.7 });
  const feedback = new FeedbackEngine({ store, audit: event => audit.append(event), minConfidence: 0.7 });

  const decision = await decisions.propose({ capability: 'lookup', input: { query: 'test' }, confidence: 0.95, evidence: [{ memoryId: 'm0', source: 'test' }] });
  assert.equal(decision.status, 'completed');
  assert.deepEqual(decision.result, { answer: 'result:test' });

  const evaluation = feedback.evaluate({ decisionId: decision.decisionId, executionId: decision.executionId, ok: true, score: 0.95, trusted: true });
  const learned = feedback.learn(evaluation, { content: 'validated lookup result', source: 'execution-feedback' });
  assert.equal(learned.learned, true);
  assert.equal(memories.length, 1);
  assert.ok(audit.list({ type: 'tool.executed' }).length >= 1);
  assert.ok(audit.list({ type: 'feedback.learned' }).length === 1);
});
