import crypto from 'node:crypto';

const REPO = /^[A-Za-z0-9_.-]+$/;
const MAX_FILE_BYTES = 1_000_000;
const DEFAULT_API = 'https://api.github.com';

function assertRepoPart(value, name) {
  if (typeof value !== 'string' || !REPO.test(value) || value.length > 100) throw new Error(`invalid_github_${name}`);
}

function normalizeOwnerRepo(input) {
  const value = String(input || '').replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/, '').replace(/^\/+|\/+$/g, '');
  const parts = value.split('/');
  if (parts.length !== 2) throw new Error('github repository must be owner/repository');
  assertRepoPart(parts[0], 'owner');
  assertRepoPart(parts[1], 'repository');
  return { owner: parts[0], repo: parts[1] };
}

function normalizePath(value) {
  if (typeof value !== 'string' || !value || value.length > 500 || value.startsWith('/') || value.split('/').includes('..')) throw new Error('invalid_github_path');
  return value;
}

function decodeBase64(value) {
  const buffer = Buffer.from(String(value || '').replace(/\n/g, ''), 'base64');
  if (buffer.length > MAX_FILE_BYTES) throw new Error('github file exceeds configured size limit');
  return buffer.toString('utf8');
}

export class GitHubSourceAdapter {
  constructor({ token = process.env.GITHUB_TOKEN, fetcher = fetch, apiBase = DEFAULT_API, timeoutMs = 10_000, maxBytes = MAX_FILE_BYTES } = {}) {
    this.token = token || null;
    this.fetcher = fetcher;
    this.apiBase = String(apiBase).replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
    this.maxBytes = maxBytes;
  }

  async #request(path, params = {}) {
    const url = new URL(`${this.apiBase}${path}`);
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers = { accept: 'application/vnd.github+json', 'x-github-api-version': '2026-03-10', 'user-agent': 'omni-agent-brain/0.5' };
      if (this.token) headers.authorization = `Bearer ${this.token}`;
      const response = await this.fetcher(url, { signal: controller.signal, redirect: 'error', headers });
      const text = await response.text();
      if (!response.ok) throw new Error(`github API returned HTTP ${response.status}`);
      let value;
      try { value = JSON.parse(text); } catch { throw new Error('invalid_github_response'); }
      return value;
    } finally { clearTimeout(timer); }
  }

  async getFile({ repository, path, ref = undefined } = {}) {
    const { owner, repo } = normalizeOwnerRepo(repository);
    const safePath = normalizePath(path);
    const value = await this.#request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${safePath}`, { ref });
    if (!value || value.type !== 'file' || typeof value.content !== 'string') throw new Error('github path is not a file');
    const content = decodeBase64(value.content);
    if (Buffer.byteLength(content, 'utf8') > this.maxBytes) throw new Error('github file exceeds configured size limit');
    return { owner, repo, path: safePath, sha: value.sha, content, htmlUrl: value.html_url, downloadUrl: value.download_url, ref: ref || value.git_url?.split('/').at(-1) };
  }

  async listDirectory({ repository, path = '', ref = undefined } = {}) {
    const { owner, repo } = normalizeOwnerRepo(repository);
    const safePath = path ? normalizePath(path) : '';
    const value = await this.#request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${safePath}`, { ref });
    if (!Array.isArray(value)) throw new Error('github path is not a directory');
    return value.filter(item => item.type === 'file').map(item => ({ name: item.name, path: item.path, sha: item.sha, size: item.size, htmlUrl: item.html_url }));
  }

  async ingestFile(input, knowledge) {
    if (!knowledge || typeof knowledge.ingestDocument !== 'function') throw new Error('knowledge service is required');
    const file = await this.getFile(input);
    const source = `github:${file.owner}/${file.repo}:${file.path}@${file.sha}`;
    const sourceHash = crypto.createHash('sha256').update(file.content).digest('hex');
    return knowledge.ingestDocument({
      name: input.name || `${file.owner}/${file.repo}/${file.path}`,
      type: 'github-file',
      trust: input.trust || 'verified',
      confidence: input.confidence ?? 0.9,
      content: file.content,
      metadata: {
        provider: 'github',
        owner: file.owner,
        repository: file.repo,
        path: file.path,
        commitSha: file.sha,
        ref: input.ref || null,
        sourceHash,
        source
      },
      url: file.htmlUrl,
      source
    });
  }

  async ingestFiles(inputs, knowledge) {
    if (!Array.isArray(inputs) || inputs.length > 25) throw new Error('inputs must contain at most 25 GitHub files');
    const results = [];
    for (const input of inputs) {
      try { results.push({ ok: true, result: await this.ingestFile(input, knowledge) }); }
      catch (error) { results.push({ ok: false, repository: input?.repository, path: input?.path, error: error.message }); }
    }
    return results;
  }
}

export { normalizeOwnerRepo, normalizePath };
