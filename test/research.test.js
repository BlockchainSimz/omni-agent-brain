import test from 'node:test';
import assert from 'node:assert/strict';
import { ResearchEngine } from '../src/research.js';

function knowledgeStub() { return { ingestDocument: document => document }; }
function response(body, type = 'text/plain') { return { ok: true, status: 200, text: async () => body, headers: { get: key => key === 'content-type' ? type : null } }; }
function engine(fetcher, options = {}) { return new ResearchEngine(knowledgeStub(), { fetcher, resolveHost: async () => {}, ...options }); }

test('ingests an HTTP source with provenance metadata', async () => {
  const result = await engine(async () => response('trusted content')).ingestUrl({ url: 'https://example.test/docs', trust: 'verified' });
  assert.equal(result.url, 'https://example.test/docs');
  assert.equal(result.trust, 'verified');
  assert.ok(result.metadata.sourceHash);
});

test('rejects non-http URLs before network access', async () => {
  let called = false;
  const result = new ResearchEngine(knowledgeStub(), { fetcher: async () => { called = true; return response('x'); }, resolveHost: async () => {} });
  await assert.rejects(() => result.ingestUrl({ url: 'file:///etc/passwd' }), /HTTP\(S\)/);
  assert.equal(called, false);
});

test('rejects oversized responses', async () => {
  await assert.rejects(() => engine(async () => response('123456'), { maxBytes: 5 }).ingestUrl({ url: 'https://example.test' }), /size limit/);
});

test('batch ingestion is bounded and isolates failures', async () => {
  let calls = 0;
  const result = await engine(async url => { calls += 1; if (url.includes('bad')) throw new Error('network failure'); return response('ok'); }).ingestUrls([{ url: 'https://good.test' }, { url: 'https://bad.test' }]);
  assert.equal(calls, 2);
  assert.equal(result[0].ok, true);
  assert.equal(result[1].ok, false);
});
