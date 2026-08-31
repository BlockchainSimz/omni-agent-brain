import http from 'node:http';
import crypto from 'node:crypto';
import { BrainStore } from './brain.js';
import { LearningPipeline } from './learning.js';
import { KnowledgeService } from './knowledge.js';
import { ResearchEngine } from './research.js';
import { consolidate, detectConflicts } from './consolidation.js';
import { validateRequest, RateLimiter, createRequestContext, errorResponse } from './service-hardening.js';
import { RuntimeObservability } from './runtime-observability.js';

const store = new BrainStore();
const learning = new LearningPipeline(store);
const knowledge = new KnowledgeService(learning);
const research = new ResearchEngine(knowledge, { allowHosts: process.env.OMNI_BRAIN_RESEARCH_ALLOWLIST ? process.env.OMNI_BRAIN_RESEARCH_ALLOWLIST.split(',').map(x => x.trim()).filter(Boolean) : undefined });
const port = Number(process.env.PORT || 3000);
const apiKey = process.env.OMNI_BRAIN_API_KEY || '';
const limiter = new RateLimiter({ limit: Number(process.env.OMNI_BRAIN_RATE_LIMIT || 60), windowMs: 60_000 });
const observability = new RuntimeObservability({ dependencies: { brain_store: true, research: true } });
let acceptingRequests = true;

function json(res, status, body, requestId) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-request-id': requestId }); res.end(JSON.stringify(body)); }
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
  try {
    if (!acceptingRequests) return json(res, 503, { error: 'service_unavailable', requestId: context.requestId }, context.requestId);
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/ready')) return json(res, 200, observability.health(), context.requestId);
    if (!authorized(req)) return json(res, 401, { error: 'unauthorized', requestId: context.requestId }, context.requestId);
    const rate = limiter.check(req.socket.remoteAddress || 'unknown');
    if (!rate.allowed) return json(res, 429, { error: 'rate_limited', requestId: context.requestId }, context.requestId);
    if (req.method === 'GET' && url.pathname === '/v1/snapshot') return json(res, 200, store.snapshot(), context.requestId);
    if (req.method === 'GET' && url.pathname === '/v1/memories/search') return json(res, 200, { results: store.searchMemories(url.searchParams.get('q') || '', { limit: url.searchParams.get('limit'), minScore: url.searchParams.get('minScore') }) }, context.requestId);
    if (req.method === 'POST' && url.pathname === '/v1/memories') return json(res, 201, store.remember(validateRequest(await body(req), { required: ['content'] })), context.requestId);
    if (req.method === 'POST' && url.pathname.startsWith('/v1/memories/') && url.pathname.endsWith('/validate')) return json(res, 200, store.validateMemory(url.pathname.split('/')[3], await body(req)), context.requestId);
    if (req.method === 'POST' && url.pathname === '/v1/knowledge') return json(res, 201, knowledge.ingestDocument(await body(req)), context.requestId);
    if (req.method === 'POST' && url.pathname === '/v1/knowledge/batch') return json(res, 201, knowledge.ingestBatch(await body(req)), context.requestId);
    if (req.method === 'POST' && url.pathname === '/v1/research/url') return json(res, 201, await research.ingestUrl(await body(req)), context.requestId);
    if (req.method === 'POST' && url.pathname === '/v1/research/batch') return json(res, 201, await research.ingestUrls(await body(req)), context.requestId);
    if (req.method === 'GET' && url.pathname === '/v1/knowledge/conflicts') return json(res, 200, { conflicts: detectConflicts(store.snapshot().memories) }, context.requestId);
    if (req.method === 'GET' && url.pathname === '/v1/knowledge/consolidation') return json(res, 200, consolidate(store.snapshot().memories), context.requestId);
    if (req.method === 'POST' && url.pathname === '/v1/skills') return json(res, 201, store.proposeSkill(await body(req)), context.requestId);
    if (req.method === 'POST' && url.pathname.startsWith('/v1/skills/') && url.pathname.endsWith('/promote')) return json(res, 200, store.promoteSkill(url.pathname.split('/')[3], await body(req)), context.requestId);
    if (req.method === 'POST' && url.pathname.startsWith('/v1/skills/') && url.pathname.endsWith('/rollback')) { const input = await body(req); return json(res, 200, store.rollbackSkill(url.pathname.split('/')[3], input.reason), context.requestId); }
    return json(res, 404, { error: 'not_found', requestId: context.requestId }, context.requestId);
  } catch (error) {
    const response = errorResponse(error, context.requestId);
    const safe = response.status === 500 ? response : { ...response, body: { ...response.body, error: response.body.error === 'request_too_large' ? 'request_too_large' : 'invalid_request' } };
    return json(res, safe.status, safe.body, context.requestId);
  } finally { observability.complete(operation, { status: res.statusCode >= 500 ? 'error' : 'success' }); }
});

const shutdown = () => { acceptingRequests = false; server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 10_000).unref(); };
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
if (process.env.NODE_ENV !== 'test') server.listen(port, () => console.log(`Omni Agent Brain listening on ${port}`));
export { server, store, research, knowledge, learning, limiter, observability };