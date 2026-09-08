const DATABASE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

export function validateRuntimeConfig(env = process.env) {
  const runtimeEnv = env.NODE_ENV || 'development';
  const port = Number(env.PORT || 3000);
  const rateLimit = Number(env.OMNI_BRAIN_RATE_LIMIT || 60);
  const rateLimitMaxEntries = Number(env.OMNI_BRAIN_RATE_LIMIT_MAX_ENTRIES || 10_000);
  const idempotencyTtlMs = Number(env.OMNI_BRAIN_IDEMPOTENCY_TTL_MS || 10 * 60_000);
  const idempotencyLeaseMs = Number(env.OMNI_BRAIN_IDEMPOTENCY_LEASE_MS || 60_000);
  const idempotencyMaxEntries = Number(env.OMNI_BRAIN_IDEMPOTENCY_MAX_ENTRIES || 10_000);
  const databaseTable = env.OMNI_BRAIN_DATABASE_TABLE || 'omni_brain_state';
  const rateLimitTable = env.OMNI_BRAIN_RATE_LIMIT_TABLE || 'omni_brain_rate_limits';
  const idempotencyTable = env.OMNI_BRAIN_IDEMPOTENCY_TABLE || 'omni_brain_idempotency';
  const vectorTable = env.OMNI_BRAIN_VECTOR_TABLE || 'omni_brain_vectors';
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error('invalid_port');
  if (!Number.isInteger(rateLimit) || rateLimit < 1) throw new Error('invalid_rate_limit');
  if (!Number.isInteger(rateLimitMaxEntries) || rateLimitMaxEntries < 1) throw new Error('invalid_rate_limit_entries');
  if (!Number.isFinite(idempotencyTtlMs) || idempotencyTtlMs < 1) throw new Error('invalid_idempotency_ttl');
  if (!Number.isFinite(idempotencyLeaseMs) || idempotencyLeaseMs < 1) throw new Error('invalid_idempotency_lease');
  if (idempotencyLeaseMs >= idempotencyTtlMs) throw new Error('invalid_idempotency_lease');
  if (!Number.isInteger(idempotencyMaxEntries) || idempotencyMaxEntries < 1) throw new Error('invalid_idempotency_entries');
  if (!DATABASE_IDENTIFIER.test(databaseTable)) throw new Error('invalid_postgres_table');
  if (!DATABASE_IDENTIFIER.test(rateLimitTable)) throw new Error('invalid_rate_limit_table');
  if (!DATABASE_IDENTIFIER.test(idempotencyTable)) throw new Error('invalid_idempotency_table');
  if (!DATABASE_IDENTIFIER.test(vectorTable)) throw new Error('invalid_vector_table');
  if (runtimeEnv === 'production' && !env.OMNI_BRAIN_API_KEY) throw new Error('missing_production_api_key');
  if (runtimeEnv === 'production' && !env.OMNI_BRAIN_DATABASE_URL) throw new Error('missing_production_database_url');
  return { port, rateLimit, rateLimitMaxEntries, idempotencyTtlMs, idempotencyLeaseMs, idempotencyMaxEntries, databaseTable, rateLimitTable, idempotencyTable, vectorTable };
}
