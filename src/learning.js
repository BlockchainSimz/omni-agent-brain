import crypto from 'node:crypto';

const TRUST = { official: 1, verified: 0.9, community: 0.7, unknown: 0.4 };

export class LearningPipeline {
  constructor(store) { this.store = store; }

  ingest(source) {
    if (!source || typeof source.content !== 'string' || !source.content.trim()) throw new Error('source content is required');
    if (source.content.length > 200_000) throw new Error('source content too large');
    const trust = TRUST[source.trust || 'unknown'] ?? TRUST.unknown;
    const sourceId = crypto.createHash('sha256').update(source.content).digest('hex');
    const memory = this.store.remember({
      type: 'observation',
      content: source.content,
      source: source.url || source.name || 'unknown',
      confidence: Math.min(1, trust * Number(source.confidence ?? 0.5)),
      metadata: { sourceId, trust, sourceType: source.type || 'document' }
    });
    return { sourceId, trust, memory };
  }

  evaluateMemory(id, evaluation) {
    if (!evaluation || typeof evaluation.passed !== 'boolean') throw new Error('evaluation must include passed');
    return this.store.validateMemory(id, evaluation);
  }

  proposeSkillFromMemory(memoryId, input) {
    const memory = this.store.requireMemory(memoryId);
    if (memory.status !== 'validated') throw new Error('only validated memories can produce skills');
    return this.store.proposeSkill({
      ...input,
      evidence: [...(input?.evidence || []), { memoryId, sourceHash: memory.sourceHash, confidence: memory.confidence }]
    });
  }
}
