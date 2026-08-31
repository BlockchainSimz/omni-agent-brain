import http from 'node:http';
import crypto from 'node:crypto';
import { BrainStore } from './brain.js';

const store = new BrainStore();
const port = Number(process.env.PORT || 3000);
const apiKey = process.env.OMNI_BRAIN_API_KEY || '';
const windowMs = 60_000;
const maxRequests = 60;
const rates = new Map();

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(body));
}

function authorized(req) {
  if (!apiKey) return process.env.NODE_ENV !== 'production';
  const supplied = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.headers['x-api-key'];
  if (!supplied || supplied.length !== apiKey.length) return false;
  return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(apiKey));
}

function rateLimited(req) {
  const key = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = rates.get(key) || { start: now, count: 0 };
  if (now - entry.start >= windowMs) { entry.start = now; entry.count = 0; }
  entry.count += 1;
  rates.set(key, entry);
  return entry.count > maxRequests;
}

async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error('request body too large');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw new Error('invalid JSON body'); }
}

const server = http.createServer(async (req, res) => {
  try {
    if (rateLimited(req)) return json(res, 429, { error: 'rate_limited' });
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, service: 'omni-agent-brain' });
    if (!authorized(req)) return json(res, 401, { error: 'unauthorized' });
    if (req.method === 'GET' && url.pathname === '/v1/snapshot') return json(res, 200, store.snapshot());
    if (req.method === 'POST' && url.pathname === '/v1/memories') return json(res, 201, store.remember(await body(req)));
    if (req.method === 'POST' && url.pathname.startsWith('/v1/memories/') && url.pathname.endsWith('/validate')) {
      const id = url.pathname.split('/')[3];
      return json(res, 200, store.validateMemory(id, await body(req)));
    }
    if (req.method === 'POST' && url.pathname === '/v1/skills') return json(res, 201, store.proposeSkill(await body(req)));
    if (req.method === 'POST' && url.pathname.startsWith('/v1/skills/') && url.pathname.endsWith('/promote')) {
      const id = url.pathname.split('/')[3];
      return json(res, 200, store.promoteSkill(id, await body(req)));
    }
    if (req.method === 'POST' && url.pathname.startsWith('/v1/skills/') && url.pathname.endsWith('/rollback')) {
      const id = url.pathname.split('/')[3];
      const input = await body(req);
      return json(res, 200, store.rollbackSkill(id, input.reason));
    }
    json(res, 404, { error: 'not_found' });
  } catch (error) {
    const message = String(error.message || 'internal error');
    const status = /not found|required|must include|blocked|requires|too large|invalid JSON|only candidate|only promoted/i.test(message) ? 400 : 500;
    json(res, status, { error: status === 500 ? 'internal_error' : 'invalid_request', message });
  }
});

if (process.env.NODE_ENV !== 'test') server.listen(port, () => console.log(`Omni Agent Brain listening on ${port}`));
export { server, store, rateLimited };
