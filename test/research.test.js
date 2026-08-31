import test from 'node:test';
import assert from 'node:assert/strict';
import { ResearchEngine } from '../src/research.js';

function knowledgeStub() { return { ingestDocument: document => document }; }
function response(body, type = 'text/plain') { return { ok: true, status: 200, text: async () => body, headers: { get: key => key === 'content-type' ? type : null } }; }

test('ingests an HTTP source with provenance metadata', async () => {
  const engine = new ResearchEngine(knowledgeStub(), { fetcher: async () => response('trusted content') });
  const result = await engine.ingestUrl({ url: 'https://example.test/docs', trust: 'verified' });
  assert.equal(result.url, 'https://example.test/docs');
  assert.equal(result.trust, 'verified');
  assert.ok(result.metadata.sourceHash);
});

test('rejects non-http URLs', async () => {
  const engine = new ResearchEngine(knowledgeStub(), { fetcher: async () => response('x') });
  await assert.rejects(() => engine.ingestUrl({ url: 'file:///etc/passwd' }), /HTTP\(S\)/);
});

test('rejects oversized responses', async () => {
  const engine = new ResearchEngine(knowledgeStub(), { fetcher: async () => response('123456'), maxBytes: 5 });
  await assert.rejects(() => engine.ingestUrl({ url: 'https://example.test' }), /size limit/);
});

test('batch ingestion is bounded and isolates failures', async () => {
  let calls = 0;
  const engine = new ResearchEngine(knowledgeStub(), { fetcher: async url => { calls += 1; if (url.includes('bad')) throw new Error('network failure'); return response('ok'); } });
  const result = await engine.ingestUrls([{ url: 'https://good.test' }, { url: 'https://bad.test' }]);
  assert.equal(calls, 2);
  assert.equal(result[0].ok, true);
  assert.equal(result[1].ok, false);
});
