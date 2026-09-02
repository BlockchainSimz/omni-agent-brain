import fs from 'node:fs';
import path from 'node:path';

export const PERSISTENCE_SCHEMA_VERSION = 1;

export function validateSnapshot(snapshot) {
  if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new Error('invalid_persistence_snapshot');
  if (snapshot.schemaVersion !== undefined && snapshot.schemaVersion !== PERSISTENCE_SCHEMA_VERSION) throw new Error('unsupported_persistence_schema');
  if (snapshot.memories !== undefined && !Array.isArray(snapshot.memories)) throw new Error('invalid_persistence_memories');
  if (snapshot.skills !== undefined && !Array.isArray(snapshot.skills)) throw new Error('invalid_persistence_skills');
  if (snapshot.executions !== undefined && !Array.isArray(snapshot.executions)) throw new Error('invalid_persistence_executions');
  if (snapshot.audit !== undefined && !Array.isArray(snapshot.audit)) throw new Error('invalid_persistence_audit');
  return snapshot;
}

export class JsonPersistence {
  constructor(file = process.env.OMNI_BRAIN_DATA_FILE || '.data/brain.json') {
    this.file = path.resolve(file);
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
  }
  load() {
    if (!fs.existsSync(this.file)) return null;
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      throw new Error('persistence_read_failed');
    }
    return validateSnapshot(parsed);
  }
  save(snapshot) {
    const value = validateSnapshot(snapshot);
    const temp = `${this.file}.${process.pid}.tmp`;
    const data = JSON.stringify({ schemaVersion: PERSISTENCE_SCHEMA_VERSION, ...value });
    try {
      const fd = fs.openSync(temp, 'w', 0o600);
      try {
        fs.writeFileSync(fd, data, { encoding: 'utf8' });
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(temp, this.file);
    } catch (error) {
      try { fs.rmSync(temp, { force: true }); } catch {}
      throw new Error(`persistence_write_failed: ${error.message}`);
    }
  }
}

export function assertPersistenceAdapter(persistence) {
  if (!persistence || typeof persistence.load !== 'function' || typeof persistence.save !== 'function') throw new Error('invalid_persistence_adapter');
  return persistence;
}
