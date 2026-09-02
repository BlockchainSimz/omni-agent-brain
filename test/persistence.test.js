import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BrainStore } from '../src/brain.js';
import { JsonPersistence } from '../src/persistence.js';

test('memories survive store restart and audit remains valid', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-brain-'));
  const file = path.join(dir, 'brain.json');
  const first = new BrainStore(new JsonPersistence(file));
  const memory = first.remember({ content: 'durable fact', source: 'test' });
  const second = new BrainStore(new JsonPersistence(file));
  assert.equal(second.snapshot().memories[0].id, memory.id);
  assert.equal(second.verifyAudit(), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('execution state survives restart and duplicate idempotency key is rejected', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-brain-exec-'));
  const file = path.join(dir, 'brain.json');
  const first = new BrainStore(new JsonPersistence(file));
  const started = first.beginExecution('request-123', { capability: 'lookup' });
  assert.equal(started.duplicate, false);
  const duplicate = first.beginExecution('request-123', { capability: 'lookup' });
  assert.equal(duplicate.duplicate, true);
  first.completeExecution('request-123', { ok: true, value: 'done' });
  const second = new BrainStore(new JsonPersistence(file));
  assert.equal(second.getExecution('request-123').status, 'completed');
  assert.deepEqual(second.getExecution('request-123').result, { ok: true, value: 'done' });
  assert.equal(second.beginExecution('request-123').duplicate, true);
  assert.equal(second.verifyAudit(), true);
  fs.rmSync(dir, { recursive: true, force: true });
});
