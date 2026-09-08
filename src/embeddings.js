import crypto from 'node:crypto';

export const DEFAULT_EMBEDDING_DIMENSIONS = 256;

function hash32(value) {
  const digest = crypto.createHash('sha256').update(value).digest();
  return digest.readUInt32BE(0);
}

function normalize(vector) {
  let norm = 0;
  for (const value of vector) norm += value * value;
  if (!norm) return vector;
  const scale = 1 / Math.sqrt(norm);
  return vector.map(value => value * scale);
}

function addFeature(vector, feature, weight) {
  const hash = hash32(feature);
  const index = hash % vector.length;
  const sign = hash & 1 ? 1 : -1;
  vector[index] += sign * weight;
}

export function tokenize(text) {
  return String(text).toLowerCase().match(/[a-z0-9_]+/g) || [];
}

export function createEmbedding(text, dimensions = DEFAULT_EMBEDDING_DIMENSIONS) {
  if (!Number.isInteger(dimensions) || dimensions < 32 || dimensions > 4096) throw new Error('invalid_embedding_dimensions');
  const value = String(text).trim().toLowerCase();
  if (!value) return new Array(dimensions).fill(0);

  const vector = new Array(dimensions).fill(0);
  const words = tokenize(value);
  for (const word of words) addFeature(vector, `w:${word}`, 1);
  for (let i = 0; i < words.length - 1; i += 1) addFeature(vector, `b:${words[i]}:${words[i + 1]}`, 0.7);

  const compact = value.replace(/\s+/g, ' ');
  for (let i = 0; i < compact.length - 2; i += 1) addFeature(vector, `c:${compact.slice(i, i + 3)}`, 0.15);
  return normalize(vector);
}

export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let an = 0;
  let bn = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = Number(a[i]) || 0;
    const bv = Number(b[i]) || 0;
    dot += av * bv;
    an += av * av;
    bn += bv * bv;
  }
  return an && bn ? dot / Math.sqrt(an * bn) : 0;
}

export function isValidEmbedding(value, dimensions = DEFAULT_EMBEDDING_DIMENSIONS) {
  return Array.isArray(value) && value.length === dimensions && value.every(item => Number.isFinite(Number(item)));
}
