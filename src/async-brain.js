import { BrainStore, MemoryPersistence } from './brain.js';
import { assertAsyncPersistenceAdapter } from './async-persistence.js';

export class AsyncBrainStore {
  constructor(persistence, { vectorStore = null } = {}) {
    this.persistence = assertAsyncPersistenceAdapter(persistence);
    this.vectorStore = vectorStore;
    this.brain = null;
    this.ready = this.#load();
    this.writeQueue = Promise.resolve();
  }

  async #load() {
    const saved = await this.persistence.load();
    const memory = new MemoryPersistence();
    if (saved !== null) memory.save(saved);
    this.brain = new BrainStore(memory);
    if (this.vectorStore) {
      try { await this.vectorStore.sync(this.brain.snapshot()); } catch {}
    }
    return this;
  }

  async #syncVectors() {
    if (!this.vectorStore) return;
    try { await this.vectorStore.sync(this.brain.snapshot()); } catch {}
  }

  async #write(operation) {
    await this.ready;
    const run = this.writeQueue.then(async () => {
      if (typeof this.persistence.withWriteLock === 'function') {
        const result = await this.persistence.withWriteLock(async tx => {
          const saved = await tx.load();
          const memory = new MemoryPersistence();
          if (saved !== null) memory.save(saved);
          const brain = new BrainStore(memory);
          const before = brain.snapshot();
          try {
            const value = await operation(brain);
            await tx.save(brain.snapshot());
            this.brain = brain;
            return value;
          } catch (error) {
            const restore = new MemoryPersistence();
            restore.save(before);
            this.brain = new BrainStore(restore);
            throw error;
          }
        });
        await this.#syncVectors();
        return result;
      }

      const before = this.brain.snapshot();
      try {
        const result = await operation(this.brain);
        await this.persistence.save(this.brain.snapshot());
        await this.#syncVectors();
        return result;
      } catch (error) {
        this.#restore(before);
        throw error;
      }
    });
    this.writeQueue = run.catch(() => {});
    return run;
  }

  #restore(snapshot) {
    const memory = new MemoryPersistence();
    memory.save(snapshot);
    this.brain = new BrainStore(memory);
  }

  async remember(input) { return this.#write(brain => brain.remember(input)); }
  async validateMemory(id, result) { return this.#write(brain => brain.validateMemory(id, result)); }
  async beginExecution(idempotencyKey, metadata = {}) { return this.#write(brain => brain.beginExecution(idempotencyKey, metadata)); }
  async completeExecution(idempotencyKey, result) { return this.#write(brain => brain.completeExecution(idempotencyKey, result)); }
  async proposeSkill(input) { return this.#write(brain => brain.proposeSkill(input)); }
  async promoteSkill(id, evaluation) { return this.#write(brain => brain.promoteSkill(id, evaluation)); }
  async rollbackSkill(id, reason) { return this.#write(brain => brain.rollbackSkill(id, reason)); }

  async searchMemories(query, options = {}) {
    await this.ready;
    if (this.vectorStore) {
      try { return await this.vectorStore.search(query, options); } catch {}
    }
    return this.brain.searchMemories(query, options);
  }

  async getExecution(idempotencyKey) {
    await this.ready;
    return this.brain.getExecution(idempotencyKey);
  }

  async snapshot() {
    await this.ready;
    return this.brain.snapshot();
  }

  async verifyAudit() {
    await this.ready;
    return this.brain.verifyAudit();
  }
}
