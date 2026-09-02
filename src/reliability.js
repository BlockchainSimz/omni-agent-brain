export const RETRYABLE_ERRORS = new Set(['ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'execution_timeout', 'temporary_unavailable']);

export function isRetryable(error) {
  return Boolean(error && (RETRYABLE_ERRORS.has(error.code) || RETRYABLE_ERRORS.has(error.message)));
}

export function backoffDelay(attempt, { baseMs = 100, maxMs = 5_000, jitter = 0.2 } = {}) {
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error('attempt must be a positive integer');
  const exponential = Math.min(maxMs, baseMs * (2 ** (attempt - 1)));
  const spread = exponential * Math.max(0, Math.min(1, jitter));
  return Math.max(0, Math.round(exponential - spread + Math.random() * spread * 2));
}

export async function retry(operation, { maxAttempts = 3, shouldRetry = isRetryable, delay = backoffDelay, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) throw new Error('maxAttempts must be between 1 and 10');
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try { return await operation(attempt); }
    catch (error) {
      lastError = error;
      if (attempt === maxAttempts || !shouldRetry(error)) throw error;
      await sleep(delay(attempt));
    }
  }
  throw lastError;
}

export function recoverStaleExecutions(executions, { now = Date.now(), staleAfterMs = 60_000 } = {}) {
  if (!Array.isArray(executions)) throw new Error('executions must be an array');
  return executions.map(execution => {
    if (execution.status !== 'running') return execution;
    const started = Date.parse(execution.startedAt || execution.createdAt || '');
    if (!Number.isFinite(started) || now - started < staleAfterMs) return execution;
    return { ...execution, status: 'recovery_required', recoveredAt: new Date(now).toISOString(), recoveryReason: 'stale_execution' };
  });
}
