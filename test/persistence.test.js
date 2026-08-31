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
});
