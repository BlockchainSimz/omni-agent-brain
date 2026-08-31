import crypto from 'node:crypto';

const STATUSES = new Set(['candidate', 'validated', 'promoted', 'rejected', 'deprecated']);

export class BrainStore {
  constructor() {
    this.memories = new Map();
    this.skills = new Map();
    this.audit = [];
  }

  remember(input) {
    if (!input?.content || !input?.source) throw new Error('content and source are required');
    const id = crypto.randomUUID();
    const item = {
      id,
      type: input.type ?? 'semantic',
      content: input.content,
      source: input.source,
      sourceHash: sha256(input.source),
      confidence: clamp(input.confidence ?? 0.5),
      status: 'candidate',
      createdAt: new Date().toISOString(),
      lastValidatedAt: null,
      metadata: input.metadata ?? {}
    };
    this.memories.set(id, item);
    this.record('memory.created', id, { source: item.source, confidence: item.confidence });
    return structuredClone(item);
  }

  validateMemory(id, result) {
    const item = this.requireMemory(id);
    if (!result || typeof result.passed !== 'boolean') throw new Error('validation result must include passed');
    item.lastValidatedAt = new Date().toISOString();
    item.confidence = clamp(result.confidence ?? item.confidence);
    item.status = result.passed ? 'validated' : 'rejected';
    this.record('memory.validated', id, { passed: result.passed, confidence: item.confidence });
    return structuredClone(item);
  }

  proposeSkill(input) {
    if (!input?.name || !input?.definition) throw new Error('skill name and definition are required');
    const id = crypto.randomUUID();
    const skill = { id, name: input.name, definition: input.definition, evidence: input.evidence ?? [], status: 'candidate', version: 1, createdAt: new Date().toISOString() };
    this.skills.set(id, skill);
    this.record('skill.proposed', id, { name: skill.name });
    return structuredClone(skill);
  }

  promoteSkill(id, evaluation) {
    const skill = this.requireSkill(id);
    if (!evaluation || evaluation.passed !== true) throw new Error('promotion requires a passing evaluation');
    if ((evaluation.regressionRate ?? 1) > 0) throw new Error('promotion blocked by regression');
    if ((evaluation.score ?? 0) < 0.8) throw new Error('promotion requires score >= 0.8');
    skill.status = 'promoted';
    skill.version += 1;
    skill.promotedAt = new Date().toISOString();
    skill.evaluation = evaluation;
    this.record('skill.promoted', id, { version: skill.version, score: evaluation.score });
    return structuredClone(skill);
  }

  rollbackSkill(id, reason) {
    const skill = this.requireSkill(id);
    skill.status = 'deprecated';
    skill.rollbackReason = reason || 'unspecified';
    skill.rolledBackAt = new Date().toISOString();
    this.record('skill.rollback', id, { reason: skill.rollbackReason });
    return structuredClone(skill);
  }

  snapshot() {
    return { memories: [...this.memories.values()], skills: [...this.skills.values()], audit: [...this.audit] };
  }

  requireMemory(id) { const item = this.memories.get(id); if (!item) throw new Error(`memory not found: ${id}`); return item; }
  requireSkill(id) { const skill = this.skills.get(id); if (!skill) throw new Error(`skill not found: ${id}`); return skill; }
  record(event, subjectId, data = {}) { this.audit.push({ id: crypto.randomUUID(), event, subjectId, data, at: new Date().toISOString() }); }
}

export function sha256(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
export function clamp(value) { return Math.max(0, Math.min(1, Number(value) || 0)); }
export { STATUSES };
