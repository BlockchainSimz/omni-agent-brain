import crypto from 'node:crypto';
import { JsonPersistence, assertPersistenceAdapter } from './persistence.js';
import { createEmbedding, DEFAULT_EMBEDDING_DIMENSIONS, isValidEmbedding } from './embeddings.js';
import { VectorIndex } from './vector-retrieval.js';
import { MemoryStoreManager } from './memory-stores.js';

const STATUSES = new Set(['candidate', 'validated', 'promoted', 'rejected', 'deprecated']);
const SECRET_KEYS = /api[_-]?key|token|secret|password|authorization|credential/i;

class MemoryPersistence { constructor() { this.snapshotValue = null; } load() { return this.snapshotValue; } save(snapshot) { this.snapshotValue = structuredClone(snapshot); } }
function sanitizeMetadata(value) { if (!value || typeof value !== 'object' || Array.isArray(value)) return {}; return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, SECRET_KEYS.test(key) ? '[REDACTED]' : val])); }

export class BrainStore {
  constructor(persistence, options = {}) {
    this.persistence = assertPersistenceAdapter(persistence || (process.env.NODE_ENV === 'test' ? new MemoryPersistence() : new JsonPersistence()));
    this.embeddingDimensions = options.embeddingDimensions ?? DEFAULT_EMBEDDING_DIMENSIONS;
    this.embed = options.embed || createEmbedding;
    this.vectorIndex = new VectorIndex({ dimensions: this.embeddingDimensions, embed: this.embed });
    const saved = this.persistence.load();
    this.memories = new Map((saved?.memories || []).map(x => [x.id, x]));
    this.skills = new Map((saved?.skills || []).map(x => [x.id, x]));
    this.executions = new Map((saved?.executions || []).map(x => [x.idempotencyKey, x]));
    this.audit = saved?.audit || [];
    this.auditHead = this.audit.at(-1)?.hash || 'GENESIS';
    if (!this.verifyAudit()) throw new Error('audit log integrity check failed');
    this.#rebuildVectorIndex();
    this.memoryStores = new MemoryStoreManager(this);
  }
  persist() { this.persistence.save(this.snapshot()); }
  remember(input) {
    if (!input?.content || typeof input.content !== 'string' || !input?.source || typeof input.source !== 'string') throw new Error('content and source are required strings');
    if (input.content.length > 100_000 || input.source.length > 10_000) throw new Error('content or source too large');
    const id = crypto.randomUUID(); const item = { id, type: input.type ?? 'semantic', content: input.content, source: input.source, sourceHash: sha256(input.source), confidence: clamp(input.confidence ?? 0.5), status: 'candidate', createdAt: new Date().toISOString(), lastValidatedAt: null, metadata: sanitizeMetadata(input.metadata) };
    item.embedding = this.embed(`${item.content} ${item.source}`, this.embeddingDimensions);
    if (!isValidEmbedding(item.embedding, this.embeddingDimensions)) throw new Error('invalid_embedding');
    this.memories.set(id, item); this.vectorIndex.upsert(id, `${item.content} ${item.source}`, item.embedding); this.record('memory.created', id, { sourceHash: item.sourceHash, confidence: item.confidence }); this.persist(); return structuredClone(item);
  }
  rememberEpisodic(input) { return this.memoryStores.rememberEpisodic(input); }
  rememberSemantic(input) { return this.memoryStores.rememberSemantic(input); }
  rememberProcedural(input) { return this.memoryStores.rememberProcedural(input); }
  rememberWorking(input, options) { return this.memoryStores.rememberWorking(input, options); }
  listMemories(type, options) { return this.memoryStores.list(type, options); }
  searchTypedMemories(type, query, options) { return this.memoryStores.search(type, query, options); }
  pruneWorkingMemory() { return this.memoryStores.pruneWorking(); }
  searchMemories(query, options = {}) {
    if (typeof query !== 'string' || !query.trim()) throw new Error('query is required');
    const limit = Math.min(Math.max(Number(options.limit) || 5, 1), 50);
    const minScore = Math.max(0, Math.min(1, Number(options.minScore) || 0));
    const matches = this.vectorIndex.search(query, Math.max(limit * 3, 10), 0);
    const now = Date.now();
    return matches
      .map(match => this.memories.get(match.id) ? { ...this.memories.get(match.id), score: match.score * (0.5 + 0.5 * this.memories.get(match.id).confidence) } : null)
      .filter(item => item && item.status !== 'rejected' && item.status !== 'deprecated' && !(item.type === 'working' && Date.parse(item.metadata?.expiresAt || '') <= now) && item.score >= minScore)
      .sort((a, b) => b.score - a.score || a.createdAt.localeCompare(b.createdAt))
      .slice(0, limit)
      .map(item => structuredClone(item));
  }
  validateMemory(id, result) {
    const item = this.requireMemory(id); if (!result || typeof result.passed !== 'boolean') throw new Error('validation result must include passed');
    item.lastValidatedAt = new Date().toISOString(); item.confidence = clamp(result.confidence ?? item.confidence); item.status = result.passed ? 'validated' : 'rejected'; this.record('memory.validated', id, { passed: result.passed, confidence: item.confidence }); this.persist(); return structuredClone(item);
  }
  beginExecution(idempotencyKey, metadata = {}) {
    if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.length > 512) throw new Error('valid idempotency key is required');
    const existing = this.executions.get(idempotencyKey); if (existing) return { duplicate: true, record: structuredClone(existing) };
    const record = { id: crypto.randomUUID(), idempotencyKey, status: 'running', ...sanitizeMetadata(metadata), createdAt: new Date().toISOString() };
    this.executions.set(idempotencyKey, record); this.record('execution.started', record.id, { idempotencyKey }); this.persist(); return { duplicate: false, record: structuredClone(record) };
  }
  completeExecution(idempotencyKey, result) {
    const record = this.executions.get(idempotencyKey); if (!record) throw new Error('execution not found');
    if (record.status !== 'running') return structuredClone(record);
    record.status = result?.ok === false ? 'failed' : 'completed'; record.result = structuredClone(result); record.completedAt = new Date().toISOString(); this.record('execution.completed', record.id, { status: record.status }); this.persist(); return structuredClone(record);
  }
  getExecution(idempotencyKey) { const record = this.executions.get(idempotencyKey); return record ? structuredClone(record) : undefined; }
  proposeSkill(input) {
    if (!input?.name || typeof input.name !== 'string' || !input?.definition || typeof input.definition !== 'string') throw new Error('skill name and definition are required strings');
    if (input.name.length > 200 || input.definition.length > 100_000) throw new Error('skill name or definition too large');
    const id = crypto.randomUUID(); const skill = { id, name: input.name, definition: input.definition, evidence: Array.isArray(input.evidence) ? input.evidence.slice(0, 100) : [], status: 'candidate', version: 1, createdAt: new Date().toISOString() };
    this.skills.set(id, skill); this.record('skill.proposed', id, { name: skill.name }); this.persist(); return structuredClone(skill);
  }
  promoteSkill(id, evaluation) {
    const skill = this.requireSkill(id); if (skill.status !== 'candidate') throw new Error('only candidate skills may be promoted');
    if (!evaluation || evaluation.passed !== true) throw new Error('promotion requires a passing evaluation'); if ((evaluation.regressionRate ?? 1) > 0) throw new Error('promotion blocked by regression'); if ((evaluation.score ?? 0) < 0.8) throw new Error('promotion requires score >= 0.8');
    skill.status = 'promoted'; skill.version += 1; skill.promotedAt = new Date().toISOString(); skill.evaluation = { passed: true, score: Number(evaluation.score), regressionRate: Number(evaluation.regressionRate ?? 0) }; this.record('skill.promoted', id, { version: skill.version, score: skill.evaluation.score }); this.persist(); return structuredClone(skill);
  }
  rollbackSkill(id, reason) {
    const skill = this.requireSkill(id); if (skill.status !== 'promoted') throw new Error('only promoted skills may be rolled back'); skill.status = 'deprecated'; skill.rollbackReason = String(reason || 'unspecified').slice(0, 2_000); skill.rolledBackAt = new Date().toISOString(); this.record('skill.rollback', id, { reason: skill.rollbackReason }); this.persist(); return structuredClone(skill);
  }
  snapshot() { return { memories: [...this.memories.values()], skills: [...this.skills.values()], executions: [...this.executions.values()], audit: [...this.audit] }; }
  requireMemory(id) { const item = this.memories.get(id); if (!item) throw new Error(`memory not found: ${id}`); return item; }
  requireSkill(id) { const skill = this.skills.get(id); if (!skill) throw new Error(`skill not found: ${id}`); return skill; }
  record(event, subjectId, data = {}) { const at = new Date().toISOString(); const id = crypto.randomUUID(); const payload = { id, event, subjectId, data, at, previousHash: this.auditHead }; const hash = sha256(JSON.stringify(payload)); const entry = { ...payload, hash }; this.audit.push(entry); this.auditHead = hash; }
  verifyAudit() { let previousHash = 'GENESIS'; for (const entry of this.audit) { const { hash, ...payload } = entry; if (payload.previousHash !== previousHash || sha256(JSON.stringify(payload)) !== hash) return false; previousHash = hash; } return true; }
  #rebuildVectorIndex() {
    this.vectorIndex.clear();
    for (const item of this.memories.values()) {
      const embedding = isValidEmbedding(item.embedding, this.embeddingDimensions) ? item.embedding : this.embed(`${item.content} ${item.source}`, this.embeddingDimensions);
      if (isValidEmbedding(embedding, this.embeddingDimensions)) {
        item.embedding = embedding;
        this.vectorIndex.upsert(item.id, `${item.content} ${item.source}`, embedding);
      }
    }
  }
}
export function sha256(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
export function clamp(value) { const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0; }
export { STATUSES, sanitizeMetadata, MemoryPersistence };
