import { BrainStore, MemoryPersistence } from './brain.js';
import { assertAsyncPersistenceAdapter } from './async-persistence.js';

export class AsyncBrainStore {
  constructor(persistence) {
    this.persistence = assertAsyncPersistenceAdapter(persistence);
    this.brain = null;
    this.ready = this.#load();
    this.writeQueue = Promise.resolve();
  }

  async #load() {
    const saved = await this.persistence.load();
    const memory = new MemoryPersistence();
    if (saved !== null) memory.save(saved);
    this.brain = new BrainStore(memory);
    return this;
  }

  async #write(operation) {
    await this.ready;
    const run = this.writeQueue.then(async () => {
      const result = await operation(this.brain);
      await this.persistence.save(this.brain.snapshot());
      return result;
    });
    this.writeQueue = run.catch(() => {});
    return run;
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
