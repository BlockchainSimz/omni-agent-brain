import { contentFingerprint } from './lifecycle.js';

function normalize(value) { return String(value || '').trim().toLowerCase().replace(/\s+/g, ' '); }

export function detectConflicts(memories) {
  const groups = new Map();
  for (const memory of memories) {
    const key = normalize(memory.topic || memory.metadata?.topic || 'general');
    const list = groups.get(key) || [];
    list.push(memory);
    groups.set(key, list);
  }
  const conflicts = [];
  for (const [topic, list] of groups) {
    const active = list.filter(x => x.status !== 'rejected' && x.status !== 'deprecated');
    const sources = new Set(active.map(x => normalize(x.content)));
    if (sources.size > 1 && active.length > 1) {
      conflicts.push({ topic, memoryIds: active.map(x => x.id), reason: 'multiple distinct claims share the same topic', requiresValidation: true });
    }
  }
  return conflicts;
}

export function consolidate(memories, options = {}) {
  const active = [...memories].filter(x => x.status === 'validated' || x.status === 'candidate');
  const byFingerprint = new Map();
  for (const memory of active) {
    const fingerprint = contentFingerprint(memory.content);
    const group = byFingerprint.get(fingerprint) || [];
    group.push(memory);
    byFingerprint.set(fingerprint, group);
  }
  const groups = [...byFingerprint.values()].filter(group => group.length > 1);
  const merged = groups.map(group => {
    const primary = [...group].sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0];
    return { primaryId: primary.id, sourceMemoryIds: group.map(x => x.id), confidence: Math.max(...group.map(x => Number(x.confidence || 0))), provenance: group.map(x => ({ id: x.id, source: x.source, sourceHash: x.sourceHash })) };
  });
  return { groups: merged, conflicts: detectConflicts(active), dryRun: options.dryRun !== false };
}
