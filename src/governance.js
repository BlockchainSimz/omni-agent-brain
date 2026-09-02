import crypto from 'node:crypto';

export class CapabilityRegistry {
  constructor(initial = {}) {
    this.versions = new Map();
    for (const [name, definition] of Object.entries(initial)) this.register(name, definition);
  }

  register(name, definition) {
    if (!name || !definition || typeof definition.execute !== 'function') throw new Error('invalid capability definition');
    const version = definition.version || '1.0.0';
    const record = { id: crypto.randomUUID(), name, version, enabled: definition.enabled === true, description: definition.description || '', execute: definition.execute, createdAt: new Date().toISOString() };
    const list = this.versions.get(name) || [];
    list.push(record);
    this.versions.set(name, list);
    return { ...record };
  }

  get(name, version) {
    const list = this.versions.get(name) || [];
    return version ? list.find(x => x.version === version) : [...list].reverse().find(x => x.enabled);
  }

  setEnabled(name, version, enabled) {
    const record = this.get(name, version);
    if (!record) throw new Error(`capability version not found: ${name}@${version}`);
    record.enabled = Boolean(enabled);
    return { ...record };
  }

  retire(name, version) { return this.setEnabled(name, version, false); }
  list() { return [...this.versions.values()].flat().map(x => ({ ...x, execute: undefined })); }
}

export class AuditLog {
  constructor(store = []) { this.store = store; }
  append(event) {
    const record = { id: crypto.randomUUID(), timestamp: new Date().toISOString(), ...event };
    this.store.push(Object.freeze(record));
    return record;
  }
  list(filter = {}) {
    return this.store.filter(event => Object.entries(filter).every(([key, value]) => event[key] === value));
  }
}
