import crypto from 'node:crypto';

const DEFAULT_LIMITS = Object.freeze({
  maxInputTokens: 8192,
  maxOutputTokens: 2048,
  maxRequestCostUsd: 1,
  dailyBudgetUsd: 10,
  providerTimeoutMs: 30000
});

function positiveFinite(value, name) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`invalid_${name}`);
  return value;
}

function integerAtLeast(value, name, minimum = 0) {
  if (!Number.isInteger(value) || value < minimum) throw new Error(`invalid_${name}`);
  return value;
}

function normalizeLimits(input = {}) {
  const merged = { ...DEFAULT_LIMITS, ...input };
  return Object.freeze({
    maxInputTokens: integerAtLeast(merged.maxInputTokens, 'max_input_tokens', 1),
    maxOutputTokens: integerAtLeast(merged.maxOutputTokens, 'max_output_tokens', 1),
    maxRequestCostUsd: positiveFinite(merged.maxRequestCostUsd, 'max_request_cost_usd'),
    dailyBudgetUsd: positiveFinite(merged.dailyBudgetUsd, 'daily_budget_usd'),
    providerTimeoutMs: integerAtLeast(merged.providerTimeoutMs, 'provider_timeout_ms', 1)
  });
}

export function estimateTokens(text) {
  if (typeof text !== 'string') throw new Error('invalid_text');
  return Math.max(1, Math.ceil(text.length / 4));
}

export function estimatePromptTokens(messages) {
  if (!Array.isArray(messages)) throw new Error('invalid_messages');
  return messages.reduce((total, message) => {
    if (!message || typeof message.role !== 'string' || typeof message.content !== 'string') throw new Error('invalid_message');
    return total + estimateTokens(message.role) + estimateTokens(message.content) + 2;
  }, 0);
}

export function calculateCostUsd({ inputTokens, outputTokens }, pricing = {}) {
  const input = integerAtLeast(inputTokens, 'input_tokens');
  const output = integerAtLeast(outputTokens, 'output_tokens');
  const inputRate = Number(pricing.inputPerMillionTokens ?? 0);
  const outputRate = Number(pricing.outputPerMillionTokens ?? 0);
  if (!Number.isFinite(inputRate) || inputRate < 0 || !Number.isFinite(outputRate) || outputRate < 0) throw new Error('invalid_model_pricing');
  return (input * inputRate + output * outputRate) / 1_000_000;
}

export class CostController {
  constructor({ limits = {}, clock = () => Date.now() } = {}) {
    this.limits = normalizeLimits(limits);
    this.clock = clock;
    this.spentUsd = 0;
    this.reservedUsd = 0;
    this.requests = 0;
    this.day = this.dayKey();
    this.reservations = new Map();
  }

  dayKey() {
    return new Date(this.clock()).toISOString().slice(0, 10);
  }

  resetIfNeeded() {
    const currentDay = this.dayKey();
    if (currentDay !== this.day) {
      this.day = currentDay;
      this.spentUsd = 0;
      this.reservedUsd = 0;
      this.requests = 0;
      this.reservations.clear();
    }
  }

  preflight({ inputTokens, maxOutputTokens, estimatedCostUsd }) {
    this.resetIfNeeded();
    integerAtLeast(inputTokens, 'input_tokens');
    integerAtLeast(maxOutputTokens, 'max_output_tokens', 1);
    positiveFinite(Math.max(estimatedCostUsd, Number.EPSILON), 'estimated_cost_usd');
    if (inputTokens > this.limits.maxInputTokens) throw new Error('model_input_token_limit');
    if (maxOutputTokens > this.limits.maxOutputTokens) throw new Error('model_output_token_limit');
    if (estimatedCostUsd > this.limits.maxRequestCostUsd) throw new Error('model_request_cost_limit');
    if (this.spentUsd + this.reservedUsd + estimatedCostUsd > this.limits.dailyBudgetUsd) throw new Error('model_daily_budget_exceeded');
    const reservationId = crypto.randomUUID();
    this.reservations.set(reservationId, estimatedCostUsd);
    this.reservedUsd += estimatedCostUsd;
    return reservationId;
  }

  release(reservationId) {
    if (!reservationId) return;
    const amount = this.reservations.get(reservationId);
    if (amount === undefined) return;
    this.reservations.delete(reservationId);
    this.reservedUsd = Math.max(0, this.reservedUsd - amount);
  }

  commit({ inputTokens, outputTokens, costUsd, reservationId }) {
    this.resetIfNeeded();
    integerAtLeast(inputTokens, 'input_tokens');
    integerAtLeast(outputTokens, 'output_tokens');
    positiveFinite(Math.max(costUsd, Number.EPSILON), 'cost_usd');
    if (inputTokens > this.limits.maxInputTokens) throw new Error('model_input_token_limit');
    if (outputTokens > this.limits.maxOutputTokens) throw new Error('model_output_token_limit');
    if (costUsd > this.limits.maxRequestCostUsd) throw new Error('model_request_cost_limit');
    this.release(reservationId);
    if (this.spentUsd + costUsd > this.limits.dailyBudgetUsd) throw new Error('model_daily_budget_exceeded');
    this.spentUsd += costUsd;
    this.requests += 1;
  }

  snapshot() {
    this.resetIfNeeded();
    return { day: this.day, spentUsd: this.spentUsd, reservedUsd: this.reservedUsd, remainingUsd: Math.max(0, this.limits.dailyBudgetUsd - this.spentUsd - this.reservedUsd), requests: this.requests, limits: this.limits };
  }
}

export const localEchoProvider = Object.freeze({
  name: 'local.echo',
  model: 'deterministic-echo-v1',
  description: 'Offline deterministic provider for development and safe tests.',
  pricing: Object.freeze({ inputPerMillionTokens: 0, outputPerMillionTokens: 0 }),
  async generate({ messages }) {
    const last = messages[messages.length - 1];
    return { text: last.content, usage: { inputTokens: estimatePromptTokens(messages), outputTokens: estimateTokens(last.content) } };
  }
});

export class ModelProviderRegistry {
  constructor({ providers = [], costController = new CostController(), defaultProvider = null, clock = () => Date.now() } = {}) {
    this.providers = new Map();
    this.costController = costController;
    this.clock = clock;
    for (const provider of providers) this.register(provider);
    this.defaultProvider = defaultProvider || providers[0]?.name || 'local.echo';
    if (!this.providers.has(this.defaultProvider)) throw new Error('model_default_provider_not_found');
  }

  register(provider) {
    if (!provider || typeof provider.name !== 'string' || !provider.name || typeof provider.generate !== 'function') throw new Error('invalid_model_provider');
    const normalized = {
      name: provider.name,
      model: typeof provider.model === 'string' && provider.model ? provider.model : provider.name,
      description: typeof provider.description === 'string' ? provider.description : '',
      pricing: provider.pricing || {},
      generate: provider.generate
    };
    this.providers.set(normalized.name, normalized);
    return { name: normalized.name, model: normalized.model, description: normalized.description, pricing: normalized.pricing };
  }

  get(name = this.defaultProvider) {
    const provider = this.providers.get(name);
    if (!provider) throw new Error('model_provider_not_found');
    return provider;
  }

  list() {
    return [...this.providers.values()].map(({ name, model, description, pricing }) => ({ name, model, description, pricing }));
  }

  async generate(request = {}) {
    const providerName = request.provider || this.defaultProvider;
    const provider = this.get(providerName);
    const messages = request.messages;
    if (!Array.isArray(messages) || messages.length < 1 || messages.length > 64) throw new Error('invalid_messages');
    const inputTokens = estimatePromptTokens(messages);
    const maxOutputTokens = integerAtLeast(request.maxOutputTokens ?? 256, 'max_output_tokens', 1);
    const estimatedCostUsd = calculateCostUsd({ inputTokens, outputTokens: maxOutputTokens }, provider.pricing);
    const reservationId = this.costController.preflight({ inputTokens, maxOutputTokens, estimatedCostUsd });
    const requestId = crypto.randomUUID();
    const startedAt = this.clock();
    const timeoutMs = this.costController.limits.providerTimeoutMs;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      timer.unref?.();
      let result;
      try {
        result = await Promise.race([
          provider.generate({
            requestId,
            model: provider.model,
            messages: structuredClone(messages),
            maxOutputTokens,
            temperature: request.temperature,
            signal: controller.signal
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('model_provider_timeout')), timeoutMs))
        ]);
      } catch (error) {
        if (controller.signal.aborted) throw new Error('model_provider_timeout');
        throw error;
      } finally {
        clearTimeout(timer);
      }
      if (!result || typeof result.text !== 'string') throw new Error('invalid_model_response');
      if (Buffer.byteLength(result.text, 'utf8') > 256 * 1024) throw new Error('model_output_too_large');
      const usage = {
        inputTokens: integerAtLeast(result.usage?.inputTokens ?? inputTokens, 'input_tokens'),
        outputTokens: integerAtLeast(result.usage?.outputTokens ?? estimateTokens(result.text), 'output_tokens')
      };
      const costUsd = calculateCostUsd(usage, provider.pricing);
      this.costController.commit({ ...usage, costUsd, reservationId });
      return {
        requestId,
        provider: provider.name,
        model: provider.model,
        text: result.text,
        usage: { ...usage, costUsd },
        durationMs: Math.max(0, this.clock() - startedAt)
      };
    } catch (error) {
      this.costController.release(reservationId);
      throw error;
    }
  }

  budget() {
    return this.costController.snapshot();
  }
}

export function createModelRegistry(env = process.env) {
  const limits = {
    maxInputTokens: env.OMNI_BRAIN_MODEL_MAX_INPUT_TOKENS,
    maxOutputTokens: env.OMNI_BRAIN_MODEL_MAX_OUTPUT_TOKENS,
    maxRequestCostUsd: env.OMNI_BRAIN_MODEL_MAX_REQUEST_COST_USD,
    dailyBudgetUsd: env.OMNI_BRAIN_MODEL_DAILY_BUDGET_USD,
    providerTimeoutMs: env.OMNI_BRAIN_MODEL_PROVIDER_TIMEOUT_MS
  };
  for (const key of Object.keys(limits)) if (limits[key] === undefined || limits[key] === '') delete limits[key];
  const defaultProvider = env.OMNI_BRAIN_DEFAULT_MODEL_PROVIDER || 'local.echo';
  return new ModelProviderRegistry({ providers: [localEchoProvider], costController: new CostController({ limits }), defaultProvider });
}
