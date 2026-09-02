import http from 'node:http';
import crypto from 'node:crypto';
import { BrainStore } from './brain.js';
import { LearningPipeline } from './learning.js';
import { KnowledgeService } from './knowledge.js';
import { ResearchEngine } from './research.js';
import { consolidate, detectConflicts } from './consolidation.js';
import { validateRequest, RateLimiter, IdempotencyStore, createRequestContext, errorResponse } from './service-hardening.js';
import { RuntimeObservability } from './runtime-observability.js';

const store = new BrainStore();
const learning = new LearningPipeline(store);
const knowledge = new KnowledgeService(learning);
const research = new ResearchEngine(knowledge, { allowHosts: process.env.OMNI_BRAIN_RESEARCH_ALLOWLIST ? process.env.OMNI_BRAIN_RESEARCH_ALLOWLIST.split(',').map(x => x.trim()).filter(Boolean) : undefined });
const port = Number(process.env.PORT || 3000);
const apiKey = process.env.OMNI_BRAIN_API_KEY || '';
const limiter = new RateLimiter({ limit: Number(process.env.OMNI_BRAIN_RATE_LIMIT || 60), windowMs: 60_000, maxEntries: Number(process.env.OMNI_BRAIN_RATE_LIMIT_MAX_ENTRIES || 10_000) });
const idempotency = new IdempotencyStore({ ttlMs: Number(process.env.OMNI_BRAIN_IDEMPOTENCY_TTL_MS || 10 * 60_000), maxEntries: Number(process.env.OMNI_BRAIN_IDEMPOTENCY_MAX_ENTRIES || 10_000) });
const observability = new RuntimeObservability({ dependencies: { brain_store: true, research: true } });
let acceptingRequests = true;

function json(res, status, body, requestId, idempotencyKey) { const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-request-id': requestId }; if (idempotencyKey) headers['idempotency-key'] = idempotencyKey; res.writeHead(status, headers); res.end(JSON.stringify(body)); }
function authorized(req) {
  if (!apiKey) return process.env.NODE_ENV !== 'production';
  const supplied = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.headers['x-api-key'];
  if (!supplied || supplied.length !== apiKey.length) return false;
  return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(apiKey));
}
async function body(req) { const chunks = []; let size = 0; for await (const chunk of req) { size += chunk.length; if (size > 64 * 1024) throw new Error('request_too_large'); chunks.push(chunk); } try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw new Error('invalid JSON body'); } }

const server = http.createServer(async (req, res) => {
  const context = createRequestContext(req.headers);
  const operation = observability.start({ correlationId: context.requestId });
  let idempotencyKey;
  try {
    if (!acceptingRequests) return json(res, 503, { error: 'service_unavailable', requestId: context.requestId }, context.requestId);
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/ready')) return json(res, 200, observability.health(), context.requestId);
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
    if (req.method === 'GET' && url.pathname === '/v1/snapshot') return json(res, 200, store.snapshot(), context.requestId);
    if (req.method === 'GET' && url.pathname === '/v1/memories/search') return json(res, 200, { results: store.searchMemories(url.searchParams.get('q') || '', { limit: url.searchParams.get('limit'), minScore: url.searchParams.get('minScore') }) }, context.requestId);
    if (req.method === 'POST' && url.pathname === '/v1/memories') { const value = await readBody(); return json(res, 201, await runWrite(() => store.remember(validateRequest(value, { required: ['content'] }))), context.requestId, idempotencyKey); }
    if (req.method === 'POST' && url.pathname.startsWith('/v1/memories/') && url.pathname.endsWith('/validate')) { const value = await readBody(); return json(res, 200, await runWrite(() => store.validateMemory(url.pathname.split('/')[3], value)), context.requestId, idempotencyKey); }
    if (req.method === 'POST' && url.pathname === '/v1/knowledge') { const value = await readBody(); return json(res, 201, await runWrite(() => knowledge.ingestDocument(value)), context.requestId, idempotencyKey); }
    if (req.method === 'POST' && url.pathname === '/v1/knowledge/batch') { const value = await readBody(); return json(res, 201, await runWrite(() => knowledge.ingestBatch(value)), context.requestId, idempotencyKey); }
    if (req.method === 'POST' && url.pathname === '/v1/research/url') { const value = await readBody(); return json(res, 201, await runWrite(() => research.ingestUrl(value)), context.requestId, idempotencyKey); }
    if (req.method === 'POST' && url.pathname === '/v1/research/batch') { const value = await readBody(); return json(res, 201, await runWrite(() => research.ingestUrls(value)), context.requestId, idempotencyKey); }
    if (req.method === 'GET' && url.pathname === '/v1/knowledge/conflicts') return json(res, 200, { conflicts: detectConflicts(store.snapshot().memories) }, context.requestId);
    if (req.method === 'GET' && url.pathname === '/v1/knowledge/consolidation') return json(res, 200, consolidate(store.snapshot().memories), context.requestId);
    if (req.method === 'POST' && url.pathname === '/v1/skills') { const value = await readBody(); return json(res, 201, await runWrite(() => store.proposeSkill(value)), context.requestId, idempotencyKey); }
    if (req.method === 'POST' && url.pathname.startsWith('/v1/skills/') && url.pathname.endsWith('/promote')) { const value = await readBody(); return json(res, 200, await runWrite(() => store.promoteSkill(url.pathname.split('/')[3], value)), context.requestId, idempotencyKey); }
    if (req.method === 'POST' && url.pathname.startsWith('/v1/skills/') && url.pathname.endsWith('/rollback')) { const value = await readBody(); return json(res, 200, await runWrite(() => store.rollbackSkill(url.pathname.split('/')[3], value.reason)), context.requestId, idempotencyKey); }
    return json(res, 404, { error: 'not_found', requestId: context.requestId }, context.requestId);
  } catch (error) {
    const response = errorResponse(error, context.requestId);
    const safe = response.status === 500 ? response : { ...response, body: { ...response.body, error: response.body.error === 'request_too_large' ? 'request_too_large' : response.body.error } };
    return json(res, safe.status, safe.body, context.requestId, idempotencyKey);
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
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
if (process.env.NODE_ENV !== 'test') server.listen(port, () => console.log(`Omni Agent Brain listening on ${port}`));
export { server, store, research, knowledge, learning, limiter, idempotency, observability };