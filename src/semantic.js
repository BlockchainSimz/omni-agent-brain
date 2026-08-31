export class SemanticIndex {
  constructor(embedder = null) {
    this.embedder = embedder;
    this.items = new Map();
  }

  async add(memory) {
    const vector = this.embedder ? await this.embedder.embed(memory.content) : null;
    this.items.set(memory.id, { memory, vector });
    return memory.id;
  }

  async search(memories, query, limit = 10) {
    if (!query || typeof query !== 'string') throw new Error('query is required');
    const active = memories.filter(m => m.status !== 'rejected' && m.status !== 'deprecated');
    if (!this.embedder) return lexicalRank(active, query, limit);
    const queryVector = await this.embedder.embed(query);
    return active.map(memory => ({ memory, score: cosine(queryVector, this.items.get(memory.id)?.vector || []) }))
      .sort((a, b) => b.score - a.score).slice(0, limit);
  }
}

function lexicalRank(memories, query, limit) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return memories.map(memory => {
    const text = memory.content.toLowerCase();
    const matches = terms.reduce((n, term) => n + (text.includes(term) ? 1 : 0), 0);
    const score = terms.length ? matches / terms.length : 0;
    return { memory, score: score * 0.8 + Number(memory.confidence || 0) * 0.2 };
  }).sort((a, b) => b.score - a.score).slice(0, limit);
}

function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return 0;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}
