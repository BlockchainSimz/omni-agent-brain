import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRuntimeConfig } from '../src/runtime-config.js';

const base = {
  NODE_ENV: 'development',
  PORT: '3000',
  OMNI_BRAIN_RATE_LIMIT: '60',
  OMNI_BRAIN_RATE_LIMIT_MAX_ENTRIES: '10000',
  OMNI_BRAIN_IDEMPOTENCY_TTL_MS: '600000',
  OMNI_BRAIN_IDEMPOTENCY_MAX_ENTRIES: '10000',
  OMNI_BRAIN_DATABASE_TABLE: 'omni_brain_state',
  OMNI_BRAIN_RATE_LIMIT_TABLE: 'omni_brain_rate_limits',
  OMNI_BRAIN_IDEMPOTENCY_TABLE: 'omni_brain_idempotency'
};

test('production requires API authentication and PostgreSQL persistence', () => {
  assert.throws(() => validateRuntimeConfig({ ...base, NODE_ENV: 'production' }), /missing_production_api_key/);
  assert.throws(() => validateRuntimeConfig({ ...base, NODE_ENV: 'production', OMNI_BRAIN_API_KEY: 'secret' }), /missing_production_database_url/);
  assert.doesNotThrow(() => validateRuntimeConfig({ ...base, NODE_ENV: 'production', OMNI_BRAIN_API_KEY: 'secret', OMNI_BRAIN_DATABASE_URL: 'postgres://omni:omni@db/omni_brain' }));
});

test('database table identifiers are validated before startup', () => {
  assert.throws(() => validateRuntimeConfig({ ...base, OMNI_BRAIN_DATABASE_TABLE: 'state;DROP TABLE users' }), /invalid_postgres_table/);
  assert.throws(() => validateRuntimeConfig({ ...base, OMNI_BRAIN_RATE_LIMIT_TABLE: 'state;DROP TABLE users' }), /invalid_rate_limit_table/);
  assert.throws(() => validateRuntimeConfig({ ...base, OMNI_BRAIN_IDEMPOTENCY_TABLE: 'state;DROP TABLE users' }), /invalid_idempotency_table/);
  assert.doesNotThrow(() => validateRuntimeConfig({ ...base, OMNI_BRAIN_DATABASE_TABLE: 'tenant_state_01', OMNI_BRAIN_RATE_LIMIT_TABLE: 'tenant_rate_limits_01', OMNI_BRAIN_IDEMPOTENCY_TABLE: 'tenant_idempotency_01' }));
});
