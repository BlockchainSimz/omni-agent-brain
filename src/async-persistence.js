import { validateSnapshot, PERSISTENCE_SCHEMA_VERSION } from './persistence.js';

export function assertAsyncPersistenceAdapter(persistence) {
  if (!persistence || typeof persistence.load !== 'function' || typeof persistence.save !== 'function') throw new Error('invalid_persistence_adapter');
  return persistence;
}

export class AsyncPersistenceAdapter {
  constructor(adapter) {
    this.adapter = assertAsyncPersistenceAdapter(adapter);
  }
  async load() {
    const snapshot = await this.adapter.load();
    return snapshot === null ? null : validateSnapshot(snapshot);
  }
  async save(snapshot) {
    const value = validateSnapshot(snapshot);
    await this.adapter.save({ schemaVersion: PERSISTENCE_SCHEMA_VERSION, ...value });
  }
  async healthcheck() {
    if (typeof this.adapter.healthcheck !== 'function') return true;
    return this.adapter.healthcheck();
  }
}
