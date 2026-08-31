const STOP_WORDS = new Set(['a','an','and','are','as','at','be','by','for','from','in','is','it','of','on','or','that','the','to','with']);

function tokens(text) {
  return String(text).toLowerCase().match(/[a-z0-9_]+/g)?.filter(t => !STOP_WORDS.has(t)) || [];
}

function vector(text) {
  const counts = new Map();
  for (const token of tokens(text)) counts.set(token, (counts.get(token) || 0) + 1);
  const total = [...counts.values()].reduce((a,b) => a+b, 0) || 1;
  return new Map([...counts].map(([k,v]) => [k, v / total]));
}

function similarity(a, b) {
  const av = vector(a), bv = vector(b);
  let dot = 0, an = 0, bn = 0;
  for (const v of av.values()) an += v*v;
  for (const v of bv.values()) bn += v*v;
  for (const [k,v] of av) dot += v * (bv.get(k) || 0);
  return an && bn ? dot / Math.sqrt(an * bn) : 0;
}

export function retrieveMemories(memories, query, options = {}) {
  if (typeof query !== 'string' || !query.trim()) throw new Error('query is required');
  const limit = Math.min(Math.max(Number(options.limit) || 5, 1), 50);
  const minScore = Math.max(0, Math.min(1, Number(options.minScore) || 0));
  return [...memories]
    .filter(item => item.status !== 'rejected' && item.status !== 'deprecated')
    .map(item => ({ ...item, score: similarity(query, `${item.content} ${item.source}`) * (0.5 + 0.5 * item.confidence) }))
    .filter(item => item.score >= minScore)
    .sort((a,b) => b.score - a.score || a.createdAt.localeCompare(b.createdAt))
    .slice(0, limit);
}
