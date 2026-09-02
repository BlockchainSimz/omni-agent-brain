import test from 'node:test';
import assert from 'node:assert/strict';
import { ResearchEngine } from '../src/research.js';

function knowledgeStub() { return { ingestDocument: document => document }; }
function response(body, type = 'text/plain', contentLength = null) {
  return {
    ok: true,
    status: 200,
    text: async () => body,
    headers: { get: key => key === 'content-type' ? type : key === 'content-length' ? contentLength : null }
  };
}
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

test('rejects URLs containing embedded credentials', async () => {
  let called = false;
  const result = new ResearchEngine(knowledgeStub(), { fetcher: async () => { called = true; return response('x'); }, resolveHost: async () => {} });
  await assert.rejects(() => result.ingestUrl({ url: 'https://user:pass@example.test/docs' }), /credentials/);
  assert.equal(called, false);
});

test('rejects private destinations returned by DNS resolution', async () => {
  let called = false;
  const result = new ResearchEngine(knowledgeStub(), {
    fetcher: async () => { called = true; return response('x'); },
    resolveHost: async () => { throw new Error('source resolves to a private network'); }
  });
  await assert.rejects(() => result.ingestUrl({ url: 'https://example.test' }), /private network/);
  assert.equal(called, false);
});

test('rejects oversized responses before downloading when content-length is known', async () => {
  let called = false;
  await assert.rejects(() => engine(async () => { called = true; return response('123456', 'text/plain', '6'); }, { maxBytes: 5 }).ingestUrl({ url: 'https://example.test' }), /size limit/);
  assert.equal(called, true);
});

test('rejects oversized streamed responses while reading', async () => {
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('123')); controller.enqueue(new TextEncoder().encode('456')); controller.close(); }
  });
  const responseWithStream = { ok: true, status: 200, body: stream, headers: { get: key => key === 'content-type' ? 'text/plain' : null } };
  await assert.rejects(() => engine(async () => responseWithStream, { maxBytes: 5 }).ingestUrl({ url: 'https://example.test' }), /size limit/);
});

test('batch ingestion is bounded and isolates failures', async () => {
  let calls = 0;
  const result = await engine(async url => { calls += 1; if (url.includes('bad')) throw new Error('network failure'); return response('ok'); }).ingestUrls([{ url: 'https://good.test' }, { url: 'https://bad.test' }]);
  assert.equal(calls, 2);
  assert.equal(result[0].ok, true);
  assert.equal(result[1].ok, false);
});
