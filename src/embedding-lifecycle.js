import { createEmbedding, DEFAULT_EMBEDDING_DIMENSIONS, isValidEmbedding } from './embeddings.js';

export const localEmbeddingProvider = Object.freeze({
  name: 'local.hash-v1',
  dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
  version: '1',
  async embed(text) { return createEmbedding(text, DEFAULT_EMBEDDING_DIMENSIONS); }
});

export class EmbeddingRegistry {
  constructor({ providers = [localEmbeddingProvider], defaultProvider = providers[0]?.name } = {}) {
    this.providers = new Map(providers.map(provider => [provider.name, provider]));
    this.defaultProvider = defaultProvider;
    if (!this.providers.has(this.defaultProvider)) throw new Error('embedding_default_provider_not_found');
  }

  register(provider) {
    if (!provider?.name || typeof provider.embed !== 'function' || !Number.isInteger(provider.dimensions)) throw new Error('invalid_embedding_provider');
    this.providers.set(provider.name, provider);
  }

  get(name = this.defaultProvider) {
    const provider = this.providers.get(name);
    if (!provider) throw new Error('embedding_provider_not_found');
    return provider;
  }

  list() {
    return [...this.providers.values()].map(({ name, dimensions, version }) => ({ name, dimensions, version }));
  }

  async embed(text, providerName) {
    const provider = this.get(providerName);
    const vector = await provider.embed(String(text));
    if (!isValidEmbedding(vector, provider.dimensions)) throw new Error('invalid_embedding_output');
    return { provider: provider.name, version: provider.version, dimensions: provider.dimensions, vector };
  }

  needsReindex(metadata = {}, providerName = this.defaultProvider) {
    const provider = this.get(providerName);
    return metadata.provider !== provider.name || metadata.version !== provider.version || metadata.dimensions !== provider.dimensions;
  }
}
