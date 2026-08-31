import crypto from 'node:crypto';

const TRUST = new Set(['official', 'verified', 'community', 'unknown']);

function normalizeUrl(value) {
  const url = new URL(String(value));
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('only HTTP(S) sources are supported');
  url.hash = '';
  return url.toString();
}

export class ResearchEngine {
  constructor(knowledge, options = {}) {
    this.knowledge = knowledge;
    this.fetcher = options.fetcher || fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxBytes = options.maxBytes ?? 1_000_000;
  }

  async ingestUrl(input) {
    const url = normalizeUrl(input?.url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(url, { signal: controller.signal, headers: { accept: 'text/plain,text/markdown,text/html;q=0.8' } });
      if (!response.ok) throw new Error(`source returned HTTP ${response.status}`);
      const contentType = response.headers.get?.('content-type') || '';
      const body = await response.text();
      if (Buffer.byteLength(body, 'utf8') > this.maxBytes) throw new Error('source exceeds configured size limit');
      if (contentType && !/(text|json|javascript|xml)/i.test(contentType)) throw new Error('unsupported source content type');
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
