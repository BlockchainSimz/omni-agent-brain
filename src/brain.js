import crypto from 'node:crypto';

const STATUSES = new Set(['candidate', 'validated', 'promoted', 'rejected', 'deprecated']);
const SECRET_KEYS = /api[_-]?key|token|secret|password|authorization|credential/i;

function sanitizeMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, SECRET_KEYS.test(key) ? '[REDACTED]' : val]));
}

export class BrainStore {
  constructor() {
    this.memories = new Map();
    this.skills = new Map();
    this.audit = [];
  }

  remember(input) {
    if (!input?.content || typeof input.content !== 'string' || !input?.source || typeof input.source !== 'string') {
      throw new Error('content and source are required strings');
    }
    if (input.content.length > 100_000 || input.source.length > 10_000) throw new Error('content or source too large');
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
      metadata: sanitizeMetadata(input.metadata)
    };
    this.memories.set(id, item);
    this.record('memory.created', id, { sourceHash: item.sourceHash, confidence: item.confidence });
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
    if (!input?.name || typeof input.name !== 'string' || !input?.definition || typeof input.definition !== 'string') {
      throw new Error('skill name and definition are required strings');
    }
    if (input.name.length > 200 || input.definition.length > 100_000) throw new Error('skill name or definition too large');
    const id = crypto.randomUUID();
    const skill = { id, name: input.name, definition: input.definition, evidence: Array.isArray(input.evidence) ? input.evidence.slice(0, 100) : [], status: 'candidate', version: 1, createdAt: new Date().toISOString() };
    this.skills.set(id, skill);
    this.record('skill.proposed', id, { name: skill.name });
    return structuredClone(skill);
  }

  promoteSkill(id, evaluation) {
    const skill = this.requireSkill(id);
    if (skill.status !== 'candidate') throw new Error('only candidate skills may be promoted');
    if (!evaluation || evaluation.passed !== true) throw new Error('promotion requires a passing evaluation');
    if ((evaluation.regressionRate ?? 1) > 0) throw new Error('promotion blocked by regression');
    if ((evaluation.score ?? 0) < 0.8) throw new Error('promotion requires score >= 0.8');
    skill.status = 'promoted';
    skill.version += 1;
    skill.promotedAt = new Date().toISOString();
    skill.evaluation = { passed: true, score: Number(evaluation.score), regressionRate: Number(evaluation.regressionRate ?? 0) };
    this.record('skill.promoted', id, { version: skill.version, score: skill.evaluation.score });
    return structuredClone(skill);
  }

  rollbackSkill(id, reason) {
    const skill = this.requireSkill(id);
    if (skill.status !== 'promoted') throw new Error('only promoted skills may be rolled back');
    skill.status = 'deprecated';
    skill.rollbackReason = String(reason || 'unspecified').slice(0, 2_000);
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
export function clamp(value) { const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0; }
export { STATUSES, sanitizeMetadata };
