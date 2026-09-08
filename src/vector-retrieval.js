import { cosineSimilarity, createEmbedding, DEFAULT_EMBEDDING_DIMENSIONS, isValidEmbedding } from './embeddings.js';

export class VectorIndex {
  constructor({ dimensions = DEFAULT_EMBEDDING_DIMENSIONS, embed = createEmbedding } = {}) {
    if (!Number.isInteger(dimensions) || dimensions < 32 || dimensions > 4096) throw new Error('invalid_vector_dimensions');
    if (typeof embed !== 'function') throw new Error('invalid_embedding_provider');
    this.dimensions = dimensions;
    this.embed = embed;
    this.entries = new Map();
  }

  upsert(id, text, embedding = null) {
    if (!id) throw new Error('vector_id_required');
    const vector = embedding || this.embed(text, this.dimensions);
    if (!isValidEmbedding(vector, this.dimensions)) throw new Error('invalid_embedding');
    this.entries.set(id, { id, vector: vector.map(Number) });
    return this.entries.get(id).vector.slice();
  }

  remove(id) {
    this.entries.delete(id);
  }

  clear() {
    this.entries.clear();
  }

  search(query, limit = 5, minScore = 0) {
    const vector = this.embed(query, this.dimensions);
    return [...this.entries.values()]
      .map(entry => ({ id: entry.id, score: cosineSimilarity(vector, entry.vector) }))
      .filter(entry => entry.score >= minScore)
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, limit);
  }
}
