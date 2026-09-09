import crypto from 'node:crypto';

const REPO = /^[A-Za-z0-9_.-]+$/;
const DEFAULT_API = 'https://api.github.com';
const DEFAULT_MAX_FILE_BYTES = 1_000_000;
const DEFAULT_MAX_FILES = 50;
const DEFAULT_ALLOWED_EXTENSIONS = new Set(['.md', '.mdx', '.txt', '.json', '.yaml', '.yml', '.csv', '.rst']);

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
  if (typeof value !== 'string' || value.length > 500 || value.startsWith('/') || value.split('/').includes('..')) throw new Error('invalid_github_path');
  return value;
}

function decodeBase64(value, maxBytes = DEFAULT_MAX_FILE_BYTES) {
  const normalized = String(value || '').replace(/\n/g, '');
  const buffer = Buffer.from(normalized, 'base64');
  if (buffer.length > maxBytes) throw new Error('github file exceeds configured size limit');
  return buffer.toString('utf8');
}

function extensionAllowed(path, allowedExtensions) {
  if (!allowedExtensions) return true;
  const lower = path.toLowerCase();
  return [...allowedExtensions].some(extension => lower.endsWith(extension));
}

export class GitHubSourceAdapter {
  constructor({ token = process.env.GITHUB_TOKEN || process.env.OMNI_BRAIN_GITHUB_TOKEN, fetcher = fetch, apiBase = DEFAULT_API, timeoutMs = 10_000, maxBytes = DEFAULT_MAX_FILE_BYTES, maxFiles = DEFAULT_MAX_FILES, allowedExtensions = DEFAULT_ALLOWED_EXTENSIONS } = {}) {
    this.token = token || null;
    this.fetcher = fetcher;
    this.apiBase = String(apiBase).replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
    this.maxBytes = maxBytes;
    this.maxFiles = maxFiles;
    this.allowedExtensions = allowedExtensions ? new Set([...allowedExtensions].map(value => String(value).toLowerCase())) : null;
  }

  async #request(path, params = {}) {
    const url = new URL(`${this.apiBase}${path}`);
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers = { accept: 'application/vnd.github+json', 'x-github-api-version': '2026-03-10', 'user-agent': 'omni-agent-brain/0.6' };
      if (this.token) headers.authorization = `Bearer ${this.token}`;
      const response = await this.fetcher(url, { signal: controller.signal, redirect: 'error', headers });
      const text = await response.text();
      if (!response.ok) {
        const remaining = response.headers?.get?.('x-ratelimit-remaining');
        const retryAfter = response.headers?.get?.('retry-after');
        const error = new Error(`github API returned HTTP ${response.status}`);
        error.status = response.status;
        if (remaining !== null && remaining !== undefined) error.rateLimitRemaining = Number(remaining);
        if (retryAfter) error.retryAfter = Number(retryAfter);
        throw error;
      }
      try { return JSON.parse(text); } catch { throw new Error('invalid_github_response'); }
    } finally { clearTimeout(timer); }
  }

  async getFile({ repository, path, ref = undefined } = {}) {
    const { owner, repo } = normalizeOwnerRepo(repository);
    const safePath = normalizePath(path);
    const value = await this.#request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${safePath}`, { ref });
    if (!value || value.type !== 'file' || typeof value.content !== 'string') throw new Error('github path is not a file');
    const content = decodeBase64(value.content, this.maxBytes);
    return { owner, repo, path: safePath, sha: value.sha, content, htmlUrl: value.html_url, downloadUrl: value.download_url, ref: ref || null };
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
      metadata: { provider: 'github', owner: file.owner, repository: file.repo, path: file.path, commitSha: file.sha, ref: file.ref, sourceHash, source },
      url: file.htmlUrl,
      source
    });
  }

  async ingestDirectory(input, knowledge) {
    const maxFiles = Math.min(Math.max(Number(input?.maxFiles) || this.maxFiles, 1), this.maxFiles);
    const allowedExtensions = input?.allowedExtensions === null ? null : new Set((input?.allowedExtensions || this.allowedExtensions) ?? []);
    const files = [];
    const visited = new Set();
    const walk = async path => {
      if (files.length >= maxFiles || visited.has(path)) return;
      visited.add(path);
      const { owner, repo } = normalizeOwnerRepo(input.repository);
      const safePath = path ? normalizePath(path) : '';
      const value = await this.#request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${safePath}`, { ref: input.ref });
      if (!Array.isArray(value)) throw new Error('github path is not a directory');
      for (const item of value) {
        if (files.length >= maxFiles) break;
        if (item.type === 'file' && extensionAllowed(item.path, allowedExtensions)) files.push({ repository: input.repository, path: item.path, ref: input.ref, trust: input.trust, confidence: input.confidence });
        else if (item.type === 'dir') await walk(item.path);
      }
    };
    await walk(input.path || '');
    return this.ingestFiles(files, knowledge);
  }

  async ingestFiles(inputs, knowledge) {
    if (!Array.isArray(inputs) || inputs.length > this.maxFiles) throw new Error(`inputs must contain at most ${this.maxFiles} GitHub files`);
    const results = [];
    for (const input of inputs) {
      try { results.push({ ok: true, result: await this.ingestFile(input, knowledge) }); }
      catch (error) { results.push({ ok: false, repository: input?.repository, path: input?.path, error: error.message, status: error.status }); }
    }
    return results;
  }
}

export { normalizeOwnerRepo, normalizePath, extensionAllowed };
