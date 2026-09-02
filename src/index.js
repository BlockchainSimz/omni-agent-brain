import http from 'node:http';
import crypto from 'node:crypto';
import { BrainStore } from './brain.js';
import { AsyncBrainStore } from './async-brain.js';
import { createPostgresPersistence, runPostgresMigration } from './postgres-runtime.js';
import { LearningPipeline } from './learning.js';
import { KnowledgeService } from './knowledge.js';
import { ResearchEngine } from './research.js';
import { consolidate, detectConflicts } from './consolidation.js';
import { validateRequest, RateLimiter, IdempotencyStore, createRequestContext, errorResponse } from './service-hardening.js';
import { RuntimeObservability } from './runtime-observability.js';

function readNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`invalid_${name.toLowerCase()}`);
  return value;
}

export function validateRuntimeConfig(env = process.env) {
  const runtimeEnv = env.NODE_ENV || 'development';
  const port = Number(env.PORT || 3000);
  const rateLimit = Number(env.OMNI_BRAIN_RATE_LIMIT || 60);
  const rateLimitMaxEntries = Number(env.OMNI_BRAIN_RATE_LIMIT_MAX_ENTRIES || 10_000);
  const idempotencyTtlMs = Number(env.OMNI_BRAIN_IDEMPOTENCY_TTL_MS || 10 * 60_000);
  const idempotencyMaxEntries = Number(env.OMNI_BRAIN_IDEMPOTENCY_MAX_ENTRIES || 10_000);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error('invalid_port');
  if (!Number.isInteger(rateLimit) || rateLimit < 1) throw new Error('invalid_rate_limit');
  if (!Number.isInteger(rateLimitMaxEntries) || rateLimitMaxEntries < 1) throw new Error('invalid_rate_limit_entries');
  if (!Number.isFinite(idempotencyTtlMs) || idempotencyTtlMs < 1) throw new Error('invalid_idempotency_ttl');
  if (!Number.isInteger(idempotencyMaxEntries) || idempotencyMaxEntries < 1) throw new Error('invalid_idempotency_entries');
  if (runtimeEnv === 'production' && !env.OMNI_BRAIN_API_KEY) throw new Error('missing_production_api_key');
  return { port, rateLimit, rateLimitMaxEntries, idempotencyTtlMs, idempotencyMaxEntries };
}

const config = validateRuntimeConfig();
const databaseUrl = process.env.OMNI_BRAIN_DATABASE_URL;
const databaseTable = process.env.OMNI_BRAIN_DATABASE_TABLE || 'omni_brain_state';
let databaseRuntime = null;
let store;

if (databaseUrl) {
  databaseRuntime = createPostgresPersistence({ url: databaseUrl, table: databaseTable });
  await runPostgresMigration(databaseRuntime.persistence);
  store = new AsyncBrainStore(databaseRuntime.persistence);
  await store.ready;
} else {
  store = new BrainStore();
}

const learning = new LearningPipeline(store);
const knowledge = new KnowledgeService(learning);
const research = new ResearchEngine(knowledge, { allowHosts: process.env.OMNI_BRAIN_RESEARCH_ALLOWLIST ? process.env.OMNI_BRAIN_RESEARCH_ALLOWLIST.split(',').map(x => x.trim()).filter(Boolean) : undefined });
const port = config.port;
const apiKey = process.env.OMNI_BRAIN_API_KEY || '';
const limiter = new RateLimiter({ limit: config.rateLimit, windowMs: 60_000, maxEntries: config.rateLimitMaxEntries });
const idempotency = new IdempotencyStore({ ttlMs: config.idempotencyTtlMs, maxEntries: config.idempotencyMaxEntries });
const observability = new RuntimeObservability({ dependencies: { brain_store: true, research: true, postgres: Boolean(databaseRuntime) } });
let acceptingRequests = true;

function json(res, status, body, requestId, idempotencyKey) { const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-request-id': requestId }; if (idempotencyKey) headers['idempotency-key'] = idempotencyKey; res.writeHead(status, headers); res.end(JSON.stringify(body)); }
function authorized(req) {
  if (!apiKey) return process.env.NODE_ENV !== 'production';
  const supplied = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.headers['x-api-key'];
  if (!supplied || supplied.length !== apiKey.length) return false;
  return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(apiKey));
}
async function body(req) {
  const declaredLength = Number(req.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > 64 * 1024) throw new Error('request_too_large');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error('request_too_large');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw new Error('invalid JSON body'); }
}

async function readiness() {
  let postgres = true;
  if (databaseRuntime) {
    try { postgres = await databaseRuntime.persistence.healthcheck(); } catch { postgres = false; }
  }
  const health = observability.health();
  const ready = health.ready && postgres;
  return { ...health, status: ready ? 'ok' : 'degraded', ready, dependencies: { ...health.dependencies, postgres } };
}

const server = http.createServer(async (req, res) => {
  const context = createRequestContext(req.headers);
  const operation = observability.start({ correlationId: context.requestId });
  let idempotencyKey;
  try {
    if (!acceptingRequests) return json(res, 503, { error: 'service_unavailable', requestId: context.requestId }, context.requestId);
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, observability.health(), context.requestId);
    if (req.method === 'GET' && url.pathname === '/ready') {
      const health = await readiness();
      return json(res, health.ready ? 200 : 503, health, context.requestId);
    }
    if (!authorized(req)) return json(res, 401, { error: 'unauthorized', requestId: context.requestId }, context.requestId);
    const rate = limiter.check(req.socket.remoteAddress || 'unknown');
    if (!rate.allowed) return json(res, 429, { error: 'rate_limited', requestId: context.requestId }, context.requestId);
    const isWrite = req.method === 'POST';
    if (isWrite) idempotencyKey = req.headers['idempotency-key'];
    let input;
    const readBody = async () => { if (input === undefined) input = await body(req); return input; };
    const runWrite = async operationFn => {
      if (!isWrite || !idempotencyKey) return operationFn();
      return idempotency.run(idempotencyKey, input, operationFn);
    };
    if (req.method === 'GET' && url.pathname === '/v1/snapshot') return json(res, 200, await store.snapshot(), context.requestId);
    if (req.method === 'GET' && url.pathname === '/v1/memories/search') return json(res, 200, { results: await store.searchMemories(url.searchParams.get('q') || '', { limit: url.searchParams.get('limit'), minScore: url.searchParams.get('minScore') }) }, context.requestId);
    if (req.method === 'POST' && url.pathname === '/v1/memories') { const value = await readBody(); return json(res, 201, await runWrite(() => store.remember(validateRequest(value, { required: ['content'] }))), context.requestId, idempotencyKey); }
    if (req.method === 'POST' && url.pathname.startsWith('/v1/memories/') && url.pathname.endsWith('/validate')) { const value = await readBody(); return json(res, 200, await runWrite(() => store.validateMemory(url.pathname.split('/')[3], value)), context.requestId, idempotencyKey); }
    if (req.method === 'POST' && url.pathname === '/v1/knowledge') { const value = await readBody(); return json(res, 201, await runWrite(() => knowledge.ingestDocument(value)), context.requestId, idempotencyKey); }
    if (req.method === 'POST' && url.pathname === '/v1/knowledge/batch') { const value = await readBody(); return json(res, 201, await runWrite(() => knowledge.ingestBatch(value)), context.requestId, idempotencyKey); }
    if (req.method === 'POST' && url.pathname === '/v1/research/url') { const value = await readBody(); return json(res, 201, await runWrite(() => research.ingestUrl(value)), context.requestId, idempotencyKey); }
    if (req.method === 'POST' && url.pathname === '/v1/research/batch') { const value = await readBody(); return json(res, 201, await runWrite(() => research.ingestUrls(value)), context.requestId, idempotencyKey); }
    if (req.method === 'GET' && url.pathname === '/v1/knowledge/conflicts') return json(res, 200, { conflicts: detectConflicts((await store.snapshot()).memories) }, context.requestId);
    if (req.method === 'GET' && url.pathname === '/v1/knowledge/consolidation') return json(res, 200, consolidate((await store.snapshot()).memories), context.requestId);
    if (req.method === 'POST' && url.pathname === '/v1/skills') { const value = await readBody(); return json(res, 201, await runWrite(() => store.proposeSkill(value)), context.requestId, idempotencyKey); }
    if (req.method === 'POST' && url.pathname.startsWith('/v1/skills/') && url.pathname.endsWith('/promote')) { const value = await readBody(); return json(res, 200, await runWrite(() => store.promoteSkill(url.pathname.split('/')[3], value)), context.requestId, idempotencyKey); }
    if (req.method === 'POST' && url.pathname.startsWith('/v1/skills/') && url.pathname.endsWith('/rollback')) { const value = await readBody(); return json(res, 200, await runWrite(() => store.rollbackSkill(url.pathname.split('/')[3], value.reason)), context.requestId, idempotencyKey); }
    return json(res, 404, { error: 'not_found', requestId: context.requestId }, context.requestId);
  } catch (error) {
    const response = errorResponse(error, context.requestId);
    return json(res, response.status, response.body, context.requestId, idempotencyKey);
  } finally { observability.complete(operation, { status: res.statusCode >= 500 ? 'error' : 'success' }); }
});

server.requestTimeout = 30_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;

const cleanup = setInterval(() => { limiter.clearExpired(); idempotency.clearExpired(); }, 60_000);
cleanup.unref();

const shutdown = () => {
  if (!acceptingRequests) return;
  acceptingRequests = false;
  clearInterval(cleanup);
  const forceExit = setTimeout(() => process.exit(1), 10_000);
  forceExit.unref();
  server.close(async () => {
    try {
      if (databaseRuntime) await databaseRuntime.close();
      clearTimeout(forceExit);
      process.exit(0);
    } catch {
      clearTimeout(forceExit);
      process.exit(1);
    }
  });
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
if (process.env.NODE_ENV !== 'test') server.listen(port, () => console.log(`Omni Agent Brain listening on ${port}`));
export { server, store, research, knowledge, learning, limiter, idempotency, observability, databaseRuntime, readiness };