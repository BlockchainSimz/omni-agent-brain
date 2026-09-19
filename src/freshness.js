import crypto from 'node:crypto';
import { revalidationQueue, lifecycleScore } from './lifecycle.js';

export class FreshnessScheduler {
  constructor({ store, validator = null, now = () => Date.now(), halfLifeDays = 30, staleThreshold = 0.35, maxBatch = 100 } = {}) {
    if (!store || typeof store.snapshot !== 'function') throw new Error('freshness_store_required');
    this.store = store;
    this.validator = validator;
    this.now = now;
    this.halfLifeDays = halfLifeDays;
    this.staleThreshold = staleThreshold;
    this.maxBatch = maxBatch;
    this.lastRunAt = null;
  }

  async plan() {
    const snapshot = await this.store.snapshot();
    const queue = revalidationQueue(snapshot.memories || [], {
      now: this.now(),
      halfLifeDays: this.halfLifeDays,
      staleThreshold: this.staleThreshold
    }).slice(0, this.maxBatch);
    return {
      runId: crypto.randomUUID(),
      generatedAt: new Date(this.now()).toISOString(),
      candidates: queue.map(({ memory, score }) => ({
        id: memory.id,
        score,
        age: Math.max(0, this.now() - Date.parse(memory.lastValidatedAt || memory.createdAt || new Date(this.now()).toISOString()))
      }))
    };
  }

  async run() {
    const plan = await this.plan();
    let validated = 0;
    let failed = 0;
    if (this.validator) {
      for (const candidate of plan.candidates) {
        try {
          const result = await this.validator(candidate.id, candidate);
          if (result !== false) validated += 1;
        } catch {
          failed += 1;
        }
      }
    }
    this.lastRunAt = plan.generatedAt;
    return { ...plan, validated, failed };
  }

  status() {
    return { lastRunAt: this.lastRunAt, halfLifeDays: this.halfLifeDays, staleThreshold: this.staleThreshold, maxBatch: this.maxBatch };
  }
}

export function freshnessScore(memory, options = {}) {
  return lifecycleScore(memory, { ...options, now: options.now ?? Date.now() });
}
