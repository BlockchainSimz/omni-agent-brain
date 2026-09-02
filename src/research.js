import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';

const TRUST = new Set(['official', 'verified', 'community', 'unknown']);
const DEFAULT_MAX_BYTES = 1_000_000;

function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return normalized === '::1' || normalized === '::' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:');
  }
  return false;
}

async function assertPublicHost(hostname) {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || net.isIP(host)) {
    if (host === 'localhost' || isPrivateAddress(host)) throw new Error('private network sources are not allowed');
    return;
  }
  const records = await dns.lookup(host, { all: true, verbatim: true });
  if (!records.length || records.some(record => isPrivateAddress(record.address))) throw new Error('source resolves to a private network');
}

function normalizeUrl(value) {
  const url = new URL(String(value));
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('only HTTP(S) sources are supported');
  if (url.username || url.password) throw new Error('URL credentials are not allowed');
  url.hash = '';
  return url;
}

async function readBoundedText(response, maxBytes) {
  const declaredLength = Number(response.headers.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new Error('source exceeds configured size limit');
  if (!response.body || typeof response.body.getReader !== 'function') {
    const body = await response.text();
    if (Buffer.byteLength(body, 'utf8') > maxBytes) throw new Error('source exceeds configured size limit');
    return body;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error('source exceeds configured size limit');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks, total).toString('utf8');
}

export class ResearchEngine {
  constructor(knowledge, options = {}) {
    this.knowledge = knowledge;
    this.fetcher = options.fetcher || fetch;
    this.resolveHost = options.resolveHost || assertPublicHost;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.allowHosts = options.allowHosts ? new Set(options.allowHosts.map(String)) : null;
  }

  async ingestUrl(input) {
    const parsed = normalizeUrl(input?.url);
    if (this.allowHosts && !this.allowHosts.has(parsed.hostname)) throw new Error('source host is not allowlisted');
    // Resolve immediately before every outbound request. Redirects are disabled so the
    // checked hostname remains the requested destination. Deployments requiring stronger
    // SSRF isolation should additionally use an egress firewall/network policy.
    await this.resolveHost(parsed.hostname);
    const url = parsed.toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(url, { signal: controller.signal, redirect: 'error', headers: { accept: 'text/plain,text/markdown,text/html;q=0.8' } });
      if (!response.ok) throw new Error(`source returned HTTP ${response.status}`);
      const contentType = response.headers.get?.('content-type') || '';
      if (contentType && !/(text|json|javascript|xml)/i.test(contentType)) throw new Error('unsupported source content type');
      const body = await readBoundedText(response, this.maxBytes);
      const sourceHash = crypto.createHash('sha256').update(body).digest('hex');
      const trust = TRUST.has(input.trust) ? input.trust : 'unknown';
      return this.knowledge.ingestDocument({ url, name: input.name || url, type: 'remote-document', trust, confidence: input.confidence ?? 0.5, content: body, metadata: { sourceHash, fetchedAt: new Date().toISOString() } });
    } finally {
      clearTimeout(timer);
    }
  }

  async ingestUrls(inputs) {
    if (!Array.isArray(inputs) || inputs.length > 20) throw new Error('inputs must contain at most 20 URLs');
    const results = [];
    for (const input of inputs) {
      try { results.push({ ok: true, result: await this.ingestUrl(input) }); }
      catch (error) { results.push({ ok: false, url: input?.url, error: error.message }); }
    }
    return results;
  }
}
