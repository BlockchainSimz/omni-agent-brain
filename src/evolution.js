import { sha256 } from './brain.js';

export class EvolutionEngine {
  constructor(store) { this.store = store; }

  proposeFromObservation({ name, definition, evidence = [] }) {
    const safeEvidence = evidence.slice(0, 20).map((item) => ({
      source: String(item.source || '').slice(0, 2_000),
      sourceHash: sha256(String(item.source || '')),
      observationHash: sha256(String(item.observation || ''))
    }));
    return this.store.proposeSkill({ name, definition, evidence: safeEvidence });
  }

  evaluateCandidate(skillId, benchmark) {
    const skill = this.store.requireSkill(skillId);
    if (skill.status !== 'candidate') throw new Error('only candidate skills may be evaluated');
    if (!benchmark || typeof benchmark.score !== 'number' || typeof benchmark.regressionRate !== 'number') {
      throw new Error('benchmark requires numeric score and regressionRate');
    }
    const evaluation = {
      passed: benchmark.passed === true,
      score: Math.max(0, Math.min(1, benchmark.score)),
      regressionRate: Math.max(0, Math.min(1, benchmark.regressionRate)),
      benchmarkId: String(benchmark.benchmarkId || 'unspecified').slice(0, 200)
    };
    this.store.record('skill.evaluated', skillId, evaluation);
    return evaluation;
  }
}
