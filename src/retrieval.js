import { cosineSimilarity, createEmbedding, DEFAULT_EMBEDDING_DIMENSIONS, isValidEmbedding } from './embeddings.js';

export function retrieveMemories(memories, query, options = {}) {
  if (typeof query !== 'string' || !query.trim()) throw new Error('query is required');
  const limit = Math.min(Math.max(Number(options.limit) || 5, 1), 50);
  const minScore = Math.max(0, Math.min(1, Number(options.minScore) || 0));
  const dimensions = Number.isInteger(options.embeddingDimensions) ? options.embeddingDimensions : DEFAULT_EMBEDDING_DIMENSIONS;
  const queryEmbedding = createEmbedding(query, dimensions);

  return [...memories]
    .filter(item => item.status !== 'rejected' && item.status !== 'deprecated')
    .map(item => {
      const embedding = isValidEmbedding(item.embedding, dimensions)
        ? item.embedding
        : createEmbedding(`${item.content} ${item.source}`, dimensions);
      return { ...item, score: cosineSimilarity(queryEmbedding, embedding) * (0.5 + 0.5 * item.confidence) };
    })
    .filter(item => item.score >= minScore)
    .sort((a, b) => b.score - a.score || a.createdAt.localeCompare(b.createdAt))
    .slice(0, limit);
}
