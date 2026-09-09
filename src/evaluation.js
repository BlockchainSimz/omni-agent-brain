import crypto from 'node:crypto';

const MAX_CASES = 500;
const MAX_STRING = 20_000;
const MATCHERS = new Set(['exact', 'contains', 'regex', 'numeric']);

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

function boundedString(value, field) {
  if (typeof value !== 'string' || value.length > MAX_STRING) throw new Error(`invalid_${field}`);
  return value;
}

function scoreCase(expected, actual) {
  if (!expected || typeof expected !== 'object') throw new Error('invalid_expected');
  const matcher = expected.matcher || 'exact';
  if (!MATCHERS.has(matcher)) throw new Error(`unsupported_matcher:${matcher}`);
  if (matcher === 'exact') return canonical(actual) === canonical(expected.value) ? 1 : 0;
  if (matcher === 'contains') {
    if (typeof actual !== 'string' || typeof expected.value !== 'string') throw new Error('contains_requires_strings');
    return actual.includes(expected.value) ? 1 : 0;
  }
  if (matcher === 'regex') {
    if (typeof actual !== 'string' || typeof expected.value !== 'string') throw new Error('regex_requires_strings');
    const flags = typeof expected.flags === 'string' && /^[dgimsuvy]*$/.test(expected.flags) ? expected.flags : '';
    return new RegExp(expected.value, flags).test(actual) ? 1 : 0;
  }
  const actualNumber = Number(actual);
  const expectedNumber = Number(expected.value);
  const tolerance = Number(expected.tolerance ?? 0);
  if (!Number.isFinite(actualNumber) || !Number.isFinite(expectedNumber) || !Number.isFinite(tolerance) || tolerance < 0) throw new Error('numeric_expected_invalid');
  return Math.abs(actualNumber - expectedNumber) <= tolerance ? 1 : 0;
}

function validateDataset(dataset) {
  if (!dataset || typeof dataset !== 'object' || Array.isArray(dataset)) throw new Error('dataset_required');
  const id = boundedString(dataset.id || '', 'dataset_id');
  const version = boundedString(String(dataset.version ?? '1'), 'dataset_version');
  if (!Array.isArray(dataset.cases) || dataset.cases.length < 1 || dataset.cases.length > MAX_CASES) throw new Error('invalid_dataset_cases');
  const seen = new Set();
  const cases = dataset.cases.map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error(`invalid_case:${index}`);
    const caseId = boundedString(String(item.id || ''), 'case_id');
    if (!caseId || seen.has(caseId)) throw new Error(`duplicate_case:${caseId}`);
    seen.add(caseId);
    if (!Object.prototype.hasOwnProperty.call(item, 'input')) throw new Error(`missing_case_input:${caseId}`);
    scoreCase(item.expected, item.expected?.value);
    return { id: caseId, input: structuredClone(item.input), expected: structuredClone(item.expected), tags: Array.isArray(item.tags) ? item.tags.slice(0, 20).map(String) : [] };
  });
  return { id, version, description: typeof dataset.description === 'string' ? dataset.description.slice(0, 2_000) : '', cases };
}

export class EvaluationService {
  constructor({ datasets = [] } = {}) {
    this.datasets = new Map();
    for (const dataset of datasets) this.register(dataset);
  }

  register(dataset) {
    const normalized = validateDataset(dataset);
    const hash = crypto.createHash('sha256').update(canonical(normalized)).digest('hex');
    const record = Object.freeze({ ...normalized, hash });
    this.datasets.set(`${record.id}@${record.version}`, record);
    return structuredClone(record);
  }

  get(id, version = '1') {
    const dataset = this.datasets.get(`${id}@${version}`);
    if (!dataset) throw new Error(`dataset_not_found:${id}@${version}`);
    return structuredClone(dataset);
  }

  list() {
    return [...this.datasets.values()].map(({ id, version, description, hash, cases }) => ({ id, version, description, hash, caseCount: cases.length }));
  }

  run(datasetOrId, outputs, options = {}) {
    const dataset = typeof datasetOrId === 'string' ? this.get(datasetOrId, options.version || '1') : validateDataset(datasetOrId);
    if (!outputs || typeof outputs !== 'object' || Array.isArray(outputs)) throw new Error('outputs_required');
    const baseline = options.baseline && typeof options.baseline === 'object' ? options.baseline : null;
    const results = dataset.cases.map(item => {
      const hasOutput = Object.prototype.hasOwnProperty.call(outputs, item.id);
      const actual = hasOutput ? outputs[item.id] : undefined;
      const score = hasOutput ? scoreCase(item.expected, actual) : 0;
      const baselineScore = baseline && Object.prototype.hasOwnProperty.call(baseline, item.id) ? scoreCase(item.expected, baseline[item.id]) : null;
      return { id: item.id, score, passed: score === 1, baselineScore, actual: hasOutput ? structuredClone(actual) : null };
    });
    const score = results.reduce((sum, item) => sum + item.score, 0) / results.length;
    const baselineResults = results.filter(item => item.baselineScore !== null);
    const regressions = baselineResults.filter(item => item.baselineScore === 1 && item.score < 1).length;
    const regressionRate = baselineResults.length ? regressions / baselineResults.length : 0;
    const passThreshold = Number.isFinite(Number(options.passThreshold)) ? Math.max(0, Math.min(1, Number(options.passThreshold))) : 0.8;
    return {
      evaluationId: crypto.createHash('sha256').update(canonical({ dataset: dataset.hash, results })).digest('hex'),
      dataset: { id: dataset.id, version: dataset.version, hash: dataset.hash, caseCount: dataset.cases.length },
      score,
      passed: score >= passThreshold && regressionRate === 0,
      passThreshold,
      regressionRate,
      regressions,
      evaluatedCases: results.length,
      results
    };
  }
}

export { canonical, scoreCase, validateDataset };
