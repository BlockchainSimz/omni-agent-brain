import crypto from 'node:crypto';

export class FeedbackEngine {
  constructor({ store, audit, minConfidence = 0.7 } = {}) {
    if (!store) throw new Error('store is required');
    this.store = store;
    this.audit = audit || (() => {});
    this.minConfidence = minConfidence;
  }

  evaluate(outcome = {}) {
    if (!outcome.decisionId || typeof outcome.ok !== 'boolean') throw new Error('decisionId and ok are required');
    const score = Number(outcome.score ?? (outcome.ok ? 1 : 0));
    if (!Number.isFinite(score) || score < 0 || score > 1) throw new Error('score must be between 0 and 1');
    const evaluation = { id: crypto.randomUUID(), decisionId: outcome.decisionId, executionId: outcome.executionId || null, passed: outcome.ok && score >= this.minConfidence, score, trusted: outcome.trusted === true, reason: outcome.reason || '', createdAt: new Date().toISOString() };
    this.audit({ type: 'feedback.evaluated', ...evaluation });
    return evaluation;
  }

  learn(evaluation, memoryInput) {
    if (!evaluation?.passed || evaluation.trusted !== true) return { learned: false, reason: 'outcome_not_eligible' };
    if (!memoryInput || typeof memoryInput.content !== 'string' || !memoryInput.content.trim()) throw new Error('memory content is required');
    const memory = this.store.remember({ ...memoryInput, type: memoryInput.type || 'execution-feedback', confidence: Math.min(1, Number(memoryInput.confidence ?? evaluation.score)) });
    this.audit({ type: 'feedback.learned', evaluationId: evaluation.id, memoryId: memory.id });
    return { learned: true, memory };
  }
}
