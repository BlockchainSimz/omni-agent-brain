const TYPES = Object.freeze({
  EPISODIC: 'episodic',
  SEMANTIC: 'semantic',
  PROCEDURAL: 'procedural',
  WORKING: 'working'
});

const TYPE_SET = new Set(Object.values(TYPES));

function clone(value) {
  return structuredClone(value);
}

function assertType(type) {
  if (!TYPE_SET.has(type)) throw new Error(`invalid_memory_type: ${type}`);
}

function assertStore(store) {
  if (!store || typeof store.remember !== 'function' || typeof store.snapshot !== 'function') {
    throw new Error('invalid_brain_store');
  }
}

export class MemoryStoreManager {
  constructor(store, { clock = () => Date.now() } = {}) {
    assertStore(store);
    if (typeof clock !== 'function') throw new Error('invalid_clock');
    this.store = store;
    this.clock = clock;
  }

  rememberEpisodic(input) {
    return this.#remember({ ...input, type: TYPES.EPISODIC, metadata: { ...input?.metadata, memoryClass: TYPES.EPISODIC } });
  }

  rememberSemantic(input) {
    return this.#remember({ ...input, type: TYPES.SEMANTIC, metadata: { ...input?.metadata, memoryClass: TYPES.SEMANTIC } });
  }

  rememberProcedural(input) {
    if (!input?.skillId || typeof input.skillId !== 'string') throw new Error('procedural memory requires skillId');
    return this.#remember({
      ...input,
      type: TYPES.PROCEDURAL,
      metadata: { ...input.metadata, memoryClass: TYPES.PROCEDURAL, skillId: input.skillId }
    });
  }

  rememberWorking(input, { ttlMs = 300_000 } = {}) {
    if (!Number.isFinite(Number(ttlMs)) || Number(ttlMs) <= 0 || Number(ttlMs) > 86_400_000) {
      throw new Error('working memory ttl must be between 1ms and 24h');
    }
    const expiresAt = new Date(this.clock() + Number(ttlMs)).toISOString();
    return this.#remember({
      ...input,
      type: TYPES.WORKING,
      metadata: { ...input?.metadata, memoryClass: TYPES.WORKING, expiresAt }
    });
  }

  list(type, { includeExpired = false } = {}) {
    assertType(type);
    const now = this.clock();
    return (this.store.snapshot().memories || [])
      .filter(item => item.type === type)
      .filter(item => includeExpired || !this.#isExpired(item, now))
      .map(clone);
  }

  get(type, id) {
    assertType(type);
    if (!id || typeof id !== 'string') throw new Error('memory id is required');
    return this.list(type, { includeExpired: true }).find(item => item.id === id);
  }

  search(type, query, options = {}) {
    assertType(type);
    const results = this.store.searchMemories(query, options);
    const now = this.clock();
    return results.filter(item => item.type === type && !this.#isExpired(item, now)).map(clone);
  }

  pruneWorking() {
    const snapshot = this.store.snapshot();
    const now = this.clock();
    const expired = (snapshot.memories || []).filter(item => item.type === TYPES.WORKING && this.#isExpired(item, now));
    if (expired.length === 0) return 0;
    if (!(this.store.memories instanceof Map)) throw new Error('brain store does not expose mutable memory registry');
    for (const item of expired) this.store.memories.delete(item.id);
    if (typeof this.store.vectorIndex?.remove === 'function') {
      for (const item of expired) this.store.vectorIndex.remove(item.id);
    }
    if (typeof this.store.record === 'function') {
      for (const item of expired) this.store.record('memory.working.expired', item.id, { expiresAt: item.metadata?.expiresAt });
    }
    if (typeof this.store.persist === 'function') this.store.persist();
    return expired.length;
  }

  #remember(input) {
    assertType(input?.type);
    return this.store.remember(input);
  }

  #isExpired(item, now) {
    if (item.type !== TYPES.WORKING) return false;
    const expiresAt = item.metadata?.expiresAt;
    return typeof expiresAt === 'string' && Number.isFinite(Date.parse(expiresAt)) && Date.parse(expiresAt) <= now;
  }
}

export { TYPES as MEMORY_TYPES, TYPE_SET as MEMORY_TYPE_SET };
