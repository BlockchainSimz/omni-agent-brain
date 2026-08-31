import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class JsonPersistence {
  constructor(file = process.env.OMNI_BRAIN_DATA_FILE || '.data/brain.json') {
    this.file = path.resolve(file);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
  }
  load() {
    if (!fs.existsSync(this.file)) return null;
    return JSON.parse(fs.readFileSync(this.file, 'utf8'));
  }
  save(snapshot) {
    const temp = `${this.file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(snapshot), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temp, this.file);
  }
}

export class DurableStore {
  constructor({ persistence } = {}) {
    this.persistence = persistence || new JsonPersistence();
    const state = this.persistence.load() || {};
    this.records = new Map(state.records || []);
    this.executions = new Map(state.executions || []);
    this.audit = state.audit || [];
  }
  flush() {
    this.persistence.save({ records: [...this.records], executions: [...this.executions], audit: this.audit });
  }
  remember(input) {
    if (!input || typeof input.content !== 'string' || !input.content.trim()) throw new Error('memory content is required');
    const record = Object.freeze({ id: input.id || crypto.randomUUID(), ...input, createdAt: input.createdAt || new Date().toISOString() });
    this.records.set(record.id, record); this.flush(); return record;
  }
  getMemory(id) { return this.records.get(id); }
  beginExecution(idempotencyKey, metadata = {}) {
    if (!idempotencyKey || typeof idempotencyKey !== 'string') throw new Error('idempotency key is required');
    const existing = this.executions.get(idempotencyKey);
    if (existing) return { duplicate: true, record: existing };
    const record = { id: crypto.randomUUID(), idempotencyKey, status: 'running', ...metadata, createdAt: new Date().toISOString() };
    this.executions.set(idempotencyKey, record); this.flush(); return { duplicate: false, record };
  }
  completeExecution(idempotencyKey, result) {
    const record = this.executions.get(idempotencyKey);
    if (!record) throw new Error('execution not found');
    record.status = result?.ok === false ? 'failed' : 'completed'; record.result = result; record.completedAt = new Date().toISOString(); this.flush();
    return Object.freeze({ ...record });
  }
  appendAudit(event) {
    const record = Object.freeze({ id: crypto.randomUUID(), timestamp: new Date().toISOString(), ...event });
    this.audit.push(record); this.flush(); return record;
  }
  listAudit(filter = {}) { return this.audit.filter(e => Object.entries(filter).every(([k, v]) => e[k] === v)); }
}
