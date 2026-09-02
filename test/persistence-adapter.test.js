import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JsonPersistence, PERSISTENCE_SCHEMA_VERSION, assertPersistenceAdapter, validateSnapshot } from '../src/persistence.js';
import { BrainStore } from '../src/brain.js';

test('JSON persistence writes a versioned, restart-readable snapshot', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-brain-schema-'));
  const file = path.join(dir, 'brain.json');
  const persistence = new JsonPersistence(file);
  persistence.save({ memories: [], skills: [], executions: [], audit: [] });
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(raw.schemaVersion, PERSISTENCE_SCHEMA_VERSION);
  assert.deepEqual(persistence.load(), raw);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('persistence rejects malformed state and unsupported schema versions', () => {
  assert.throws(() => validateSnapshot({ memories: {} }), /invalid_persistence_memories/);
  assert.throws(() => validateSnapshot({ schemaVersion: 999 }), /unsupported_persistence_schema/);
});

test('BrainStore rejects invalid persistence adapters', () => {
  assert.throws(() => new BrainStore({ load: () => null }), /invalid_persistence_adapter/);
  assert.doesNotThrow(() => assertPersistenceAdapter({ load: () => null, save: () => {} }));
});

test('corrupt JSON fails closed instead of silently resetting state', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-brain-corrupt-'));
  const file = path.join(dir, 'brain.json');
  fs.writeFileSync(file, '{not-json', { mode: 0o600 });
  assert.throws(() => new JsonPersistence(file).load(), /persistence_read_failed/);
  fs.rmSync(dir, { recursive: true, force: true });
});
