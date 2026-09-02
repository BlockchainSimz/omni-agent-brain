import test from 'node:test';
import assert from 'node:assert/strict';
import { CapabilityRegistry, AuditLog } from '../src/governance.js';

test('registry versions capabilities and defaults to enabled latest', () => {
  const registry = new CapabilityRegistry();
  registry.register('lookup', { version: '1.0.0', enabled: true, execute: async () => 'v1' });
  registry.register('lookup', { version: '2.0.0', enabled: true, execute: async () => 'v2' });
  assert.equal(registry.get('lookup').version, '2.0.0');
  assert.equal(registry.list().length, 2);
});

test('retirement disables a capability version', () => {
  const registry = new CapabilityRegistry({ lookup: { version: '1.0.0', enabled: true, execute: async () => 'ok' } });
  registry.retire('lookup', '1.0.0');
  assert.equal(registry.get('lookup'), undefined);
});

test('audit log persists immutable records and supports filtering', () => {
  const audit = new AuditLog();
  const record = audit.append({ type: 'tool.executed', capability: 'lookup', ok: true });
  assert.ok(record.id);
  assert.equal(audit.list({ capability: 'lookup' }).length, 1);
  assert.throws(() => { record.ok = false; }, TypeError);
});
