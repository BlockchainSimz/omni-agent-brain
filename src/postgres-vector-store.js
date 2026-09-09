import { createEmbedding, DEFAULT_EMBEDDING_DIMENSIONS, isValidEmbedding } from './embeddings.js';

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

function vectorLiteral(vector) {
  return `[${vector.map(Number).join(',')}]`;
}

function decodeMemory(value) {
  if (typeof value === 'string') return JSON.parse(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_stored_memory');
  return value;
}

export class PostgresVectorStore {
  constructor({ pool, table = 'omni_brain_vectors', dimensions = DEFAULT_EMBEDDING_DIMENSIONS, embed = createEmbedding } = {}) {
    if (!pool || typeof pool.query !== 'function') throw new Error('invalid_postgres_pool');
    if (!IDENTIFIER.test(table)) throw new Error('invalid_postgres_table');
    if (!Number.isInteger(dimensions) || dimensions < 32 || dimensions > 2000) throw new Error('invalid_vector_dimensions');
    if (typeof embed !== 'function') throw new Error('invalid_embedding_provider');
    this.pool = pool;
    this.table = table;
    this.dimensions = dimensions;
    this.embed = embed;
  }

  async init() {
    await this.pool.query('CREATE EXTENSION IF NOT EXISTS vector');
    await this.pool.query(`CREATE TABLE IF NOT EXISTS ${this.table} (memory_id TEXT PRIMARY KEY, embedding vector(${this.dimensions}) NOT NULL, memory JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await this.pool.query(`CREATE INDEX IF NOT EXISTS ${this.table}_embedding_hnsw_idx ON ${this.table} USING hnsw (embedding vector_cosine_ops)`);
    await this.pool.query(`CREATE INDEX IF NOT EXISTS ${this.table}_updated_at_idx ON ${this.table} (updated_at)`);
  }

  async upsert(memory, executor = this.pool) {
    if (!memory?.id) throw new Error('memory_id_required');
    const embedding = isValidEmbedding(memory.embedding, this.dimensions)
      ? memory.embedding
      : this.embed(`${memory.content} ${memory.source}`, this.dimensions);
    if (!isValidEmbedding(embedding, this.dimensions)) throw new Error('invalid_embedding');
    await executor.query(
      `INSERT INTO ${this.table} (memory_id, embedding, memory, updated_at) VALUES ($1, $2::vector, $3::jsonb, NOW()) ON CONFLICT (memory_id) DO UPDATE SET embedding = EXCLUDED.embedding, memory = EXCLUDED.memory, updated_at = NOW()`,
      [memory.id, vectorLiteral(embedding), JSON.stringify(memory)]
    );
  }

  async remove(memoryId, executor = this.pool) {
    await executor.query(`DELETE FROM ${this.table} WHERE memory_id = $1`, [memoryId]);
  }

  async sync(snapshot, executor = this.pool) {
    const now = Date.now();
    const memories = (snapshot?.memories || []).filter(memory => {
      if (memory.status === 'rejected' || memory.status === 'deprecated') return false;
      if (memory.type === 'working' && Date.parse(memory.metadata?.expiresAt || '') <= now) return false;
      return true;
    });
    const activeIds = new Set(memories.map(memory => memory.id));
    for (const memory of memories) await this.upsert(memory, executor);
    if (activeIds.size === 0) await executor.query(`DELETE FROM ${this.table}`);
    else await executor.query(`DELETE FROM ${this.table} WHERE NOT (memory_id = ANY($1::text[]))`, [Array.from(activeIds)]);
  }

  async search(query, { limit = 5, minScore = 0 } = {}) {
    if (typeof query !== 'string' || !query.trim()) throw new Error('query is required');
    const boundedLimit = Math.min(Math.max(Number(limit) || 5, 1), 50);
    const boundedMinScore = Math.max(0, Math.min(1, Number(minScore) || 0));
    const embedding = this.embed(query, this.dimensions);
    const result = await this.pool.query(
      `SELECT memory, memory->>'id' AS memory_id, 1 - (embedding <=> $1::vector) AS score FROM ${this.table} WHERE (memory->>'type' IS DISTINCT FROM 'working' OR NULLIF(memory->'metadata'->>'expiresAt', '') IS NULL OR (memory->'metadata'->>'expiresAt')::timestamptz > NOW()) AND 1 - (embedding <=> $1::vector) >= $2 ORDER BY embedding <=> $1::vector LIMIT $3`,
      [vectorLiteral(embedding), boundedMinScore, boundedLimit]
    );
    return result.rows.map(row => {
      const memory = decodeMemory(row.memory);
      if (!memory.id && row.memory_id) memory.id = row.memory_id;
      return { ...memory, score: Number(row.score) };
    });
  }

  async count() {
    const result = await this.pool.query(`SELECT COUNT(*)::int AS count FROM ${this.table}`);
    return Number(result.rows[0]?.count || 0);
  }
}
