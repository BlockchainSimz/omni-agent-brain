import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubSourceAdapter, normalizeOwnerRepo, normalizePath } from '../src/github-source.js';

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('normalizes GitHub repositories and rejects traversal', () => {
  assert.deepEqual(normalizeOwnerRepo('https://github.com/octocat/Hello-World.git'), { owner: 'octocat', repo: 'Hello-World' });
  assert.equal(normalizePath('docs/guide.md'), 'docs/guide.md');
  assert.throws(() => normalizePath('../secret'), /invalid_github_path/);
});

test('fetches a GitHub file and preserves commit provenance', async () => {
  const adapter = new GitHubSourceAdapter({
    fetcher: async () => response({ type: 'file', encoding: 'base64', content: Buffer.from('safe knowledge').toString('base64'), sha: 'abc123', html_url: 'https://github.com/acme/demo/blob/abc123/docs/a.md' })
  });
  const file = await adapter.getFile({ repository: 'acme/demo', path: 'docs/a.md', ref: 'main' });
  assert.equal(file.content, 'safe knowledge');
  assert.equal(file.sha, 'abc123');
  assert.equal(file.owner, 'acme');
});

test('ingests GitHub content through the knowledge service', async () => {
  const adapter = new GitHubSourceAdapter({
    fetcher: async () => response({ type: 'file', encoding: 'base64', content: Buffer.from('validated release procedure').toString('base64'), sha: 'deadbeef', html_url: 'https://github.com/acme/demo/blob/deadbeef/README.md' })
  });
  let document;
  const knowledge = { ingestDocument(value) { document = value; return { id: 'memory-1', source: value.source }; } };
  const result = await adapter.ingestFile({ repository: 'acme/demo', path: 'README.md', ref: 'main' }, knowledge);
  assert.equal(result.id, 'memory-1');
  assert.equal(document.metadata.provider, 'github');
  assert.equal(document.metadata.commitSha, 'deadbeef');
  assert.equal(document.metadata.repository, 'demo');
  assert.equal(document.trust, 'verified');
  assert.match(document.source, /github:acme\/demo:README\.md@deadbeef/);
});

test('batch ingestion isolates individual source failures', async () => {
  let calls = 0;
  const adapter = new GitHubSourceAdapter({ fetcher: async () => { calls += 1; if (calls === 1) return response({ type: 'file', content: Buffer.from('ok').toString('base64'), sha: 'a', html_url: 'https://github.com/a/b/blob/a/a.txt' }); return response({}, 404); } });
  const knowledge = { ingestDocument(value) { return { source: value.source }; } };
  const results = await adapter.ingestFiles([{ repository: 'a/b', path: 'a.txt' }, { repository: 'a/b', path: 'b.txt' }], knowledge);
  assert.equal(results.length, 2);
  assert.equal(results[0].ok, true);
  assert.equal(results[1].ok, false);
});
