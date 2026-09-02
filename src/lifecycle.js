import { sha256 } from './brain.js';

function tokenize(text) { return new Set(String(text).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)); }
function jaccard(a, b) { const x = tokenize(a), y = tokenize(b); const intersection = [...x].filter(v => y.has(v)).length; const union = new Set([...x, ...y]).size; return union ? intersection / union : 0; }

export function freshness(memory, now = Date.now(), halfLifeDays = 30) {
  if (!memory?.createdAt) return 0;
  const ageDays = Math.max(0, (now - Date.parse(memory.lastValidatedAt || memory.createdAt)) / 86400000);
  return Math.pow(0.5, ageDays / Math.max(1, halfLifeDays));
}

export function lifecycleScore(memory, options = {}) {
  const confidence = Number(memory?.confidence ?? 0);
  const fresh = freshness(memory, options.now, options.halfLifeDays ?? 30);
  return confidence * fresh;
}

export function findDuplicates(memories, threshold = 0.85) {
  const list = [...memories]; const duplicates = [];
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const similarity = jaccard(list[i].content, list[j].content);
      if (similarity >= threshold) duplicates.push({ primaryId: list[i].id, duplicateId: list[j].id, similarity });
    }
  }
  return duplicates;
}

export function revalidationQueue(memories, options = {}) {
  const staleThreshold = options.staleThreshold ?? 0.35;
  return [...memories]
    .filter(memory => memory.status === 'candidate' || memory.status === 'validated')
    .map(memory => ({ memory, score: lifecycleScore(memory, options) }))
    .filter(item => item.score < staleThreshold)
    .sort((a, b) => a.score - b.score);
}

export function contentFingerprint(content) { return sha256(String(content).trim().toLowerCase().replace(/\s+/g, ' ')); }
