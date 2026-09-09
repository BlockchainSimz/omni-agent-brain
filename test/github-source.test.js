import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubSourceAdapter, normalizeOwnerRepo, normalizePath, extensionAllowed } from '../src/github-source.js';

function response(body, status = 200, headers = {}) {
  return { ok: status >= 200 && status < 300, status, headers: { get: key => headers[key] ?? null }, text: async () => JSON.stringify(body) };
}

function filePayload(path, content = 'hello github') {
  return { type: 'file', path, sha: `sha-${path}`, content: Buffer.from(content).toString('base64'), html_url: `https://github.com/acme/demo/blob/main/${path}` };
}

test('normalizes GitHub repositories and rejects traversal', () => {
  assert.deepEqual(normalizeOwnerRepo('https://github.com/acme/demo.git'), { owner: 'acme', repo: 'demo' });
  assert.throws(() => normalizePath('../secret'), /invalid_github_path/);
  assert.equal(extensionAllowed('docs/guide.md', new Set(['.md'])), true);
  assert.equal(extensionAllowed('src/app.js', new Set(['.md'])), false);
});

test('fetches a bounded GitHub file with provenance', async () => {
  const adapter = new GitHubSourceAdapter({ fetcher: async url => {
    assert.equal(url.pathname, '/repos/acme/demo/contents/docs/guide.md');
    return response(filePayload('docs/guide.md', 'approved knowledge'));
  } });
  const ingested = [];
  const result = await adapter.ingestFile({ repository: 'acme/demo', path: 'docs/guide.md', ref: 'main' }, { ingestDocument: value => { ingested.push(value); return value; } });
  assert.equal(result.type, 'github-file');
  assert.equal(result.metadata.provider, 'github');
  assert.equal(result.metadata.repository, 'demo');
  assert.equal(result.metadata.ref, 'main');
  assert.equal(ingested[0].content, 'approved knowledge');
});

test('recursively ingests approved text files from a repository directory', async () => {
  const calls = [];
  const adapter = new GitHubSourceAdapter({ fetcher: async url => {
    calls.push(url.pathname);
    if (url.pathname.endsWith('/contents/docs')) return response([
      { type: 'file', path: 'docs/guide.md', sha: 'guide', name: 'guide.md' },
      { type: 'dir', path: 'docs/nested', name: 'nested' }
    ]);
    if (url.pathname.endsWith('/contents/docs/nested')) return response([
      { type: 'file', path: 'docs/nested/notes.txt', sha: 'notes', name: 'notes.txt' },
      { type: 'file', path: 'docs/nested/app.js', sha: 'js', name: 'app.js' }
    ]);
    if (url.pathname.endsWith('/contents/docs/guide.md')) return response(filePayload('docs/guide.md', 'guide'));
    if (url.pathname.endsWith('/contents/docs/nested/notes.txt')) return response(filePayload('docs/nested/notes.txt', 'notes'));
    throw new Error(`unexpected ${url.pathname}`);
  } });
  const results = await adapter.ingestDirectory({ repository: 'acme/demo', path: 'docs', ref: 'main' }, { ingestDocument: value => value });
  assert.equal(results.length, 2);
  assert.equal(results.every(result => result.ok), true);
  assert.equal(calls.some(path => path.endsWith('/app.js')), false);
});

test('isolates GitHub API failures in batch ingestion', async () => {
  const adapter = new GitHubSourceAdapter({ fetcher: async url => url.pathname.includes('bad') ? response({ message: 'not found' }, 404, { 'x-ratelimit-remaining': '10' }) : response(filePayload('good.md')) });
  const results = await adapter.ingestFiles([
    { repository: 'acme/demo', path: 'good.md' },
    { repository: 'acme/demo', path: 'bad.md' }
  ], { ingestDocument: value => value });
  assert.equal(results[0].ok, true);
  assert.equal(results[1].ok, false);
  assert.equal(results[1].status, 404);
});

test('enforces configured GitHub file-size limits', async () => {
  const adapter = new GitHubSourceAdapter({ maxBytes: 4, fetcher: async () => response(filePayload('docs/a.md', '12345')) });
  await assert.rejects(() => adapter.getFile({ repository: 'acme/demo', path: 'docs/a.md' }), /size limit/);
});
