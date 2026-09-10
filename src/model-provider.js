import crypto from 'node:crypto';

const NAME = /^[a-z][a-z0-9._-]{1,63}$/;
const DEFAULT_LIMITS = Object.freeze({ maxInputTokens: 8_192, maxOutputTokens: 2_048, maxRequestCostUsd: 1, dailyBudgetUsd: 10, providerTimeoutMs: 30_000 });

function finiteNonNegative(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`invalid_${name}`);
  return number;
}

function integerAtLeast(value, name, minimum = 0) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum) throw new Error(`invalid_${name}`);
  return number;
}

export function estimateTokens(text) {
  if (typeof text !== 'string') throw new Error('invalid_model_input');
  return Math.ceil(Buffer.byteLength(text, 'utf8') / 4);
}

export function estimatePromptTokens(messages) {
  if (!Array.isArray(messages)) throw new Error('invalid_messages');
  return messages.reduce((total, message) => {
    if (!message || typeof message !== 'object' || typeof message.content !== 'string') throw new Error('invalid_message');
    return total + estimateTokens(message.content) + 4;
  }, 0);
}

export function calculateCostUsd(usage, pricing = {}) {
  const input = finiteNonNegative(usage?.inputTokens ?? 0, 'input_tokens');
  const output = finiteNonNegative(usage?.outputTokens ?? 0, 'output_tokens');
  const inputPerMillion = finiteNonNegative(pricing.inputPerMillionTokens ?? 0, 'input_price');
  const outputPerMillion = finiteNonNegative(pricing.outputPerMillionTokens ?? 0, 'output_price');
  return Number(((input * inputPerMillion + output * outputPerMillion) / 1_000_000).toFixed(8));
}

export class CostController {
  constructor({ limits = {}, clock = () => Date.now() } = {}) {
    this.limits = {
      maxInputTokens: integerAtLeast(limits.maxInputTokens ?? DEFAULT_LIMITS.maxInputTokens, 'max_input_tokens', 1),
      maxOutputTokens: integerAtLeast(limits.maxOutputTokens ?? DEFAULT_LIMITS.maxOutputTokens, 'max_output_tokens', 1),
      maxRequestCostUsd: finiteNonNegative(limits.maxRequestCostUsd ?? DEFAULT_LIMITS.maxRequestCostUsd, 'max_request_cost_usd'),
      dailyBudgetUsd: finiteNonNegative(limits.dailyBudgetUsd ?? DEFAULT_LIMITS.dailyBudgetUsd, 'daily_budget_usd'),
      providerTimeoutMs: integerAtLeast(limits.providerTimeoutMs ?? DEFAULT_LIMITS.providerTimeoutMs, 'provider_timeout_ms', 1)
    };
    this.clock = clock;
    this.day = this.dayKey();
    this.spentUsd = 0;
    this.reservedUsd = 0;
    this.requests = 0;
    this.reservations = new Map();
  }

  dayKey() { return new Date(this.clock()).toISOString().slice(0, 10); }

  resetIfNeeded() {
    const day = this.dayKey();
    if (day !== this.day) {
      this.day = day;
      this.spentUsd = 0;
      this.reservedUsd = 0;
      this.requests = 0;
      this.reservations.clear();
    }
  }

  preflight({ inputTokens, maxOutputTokens, estimatedCostUsd }) {
    this.resetIfNeeded();
    const input = integerAtLeast(inputTokens, 'input_tokens');
    const output = integerAtLeast(maxOutputTokens, 'max_output_tokens');
    const estimate = finiteNonNegative(estimatedCostUsd, 'estimated_cost_usd');
    if (input > this.limits.maxInputTokens) throw new Error('model_input_token_limit');
    if (output > this.limits.maxOutputTokens) throw new Error('model_output_token_limit');
    if (estimate > this.limits.maxRequestCostUsd) throw new Error('model_request_cost_limit');
    if (this.spentUsd + this.reservedUsd + estimate > this.limits.dailyBudgetUsd) throw new Error('model_daily_budget_exceeded');
    const reservationId = crypto.randomUUID();
    this.reservations.set(reservationId, estimate);
    this.reservedUsd = Number((this.reservedUsd + estimate).toFixed(8));
    return reservationId;
  }

  release(reservationId) {
    this.resetIfNeeded();
    if (!reservationId) return;
    const estimate = this.reservations.get(reservationId);
    if (estimate === undefined) return;
    this.reservations.delete(reservationId);
    this.reservedUsd = Number(Math.max(0, this.reservedUsd - estimate).toFixed(8));
  }

  commit({ inputTokens, outputTokens, costUsd, reservationId }) {
    this.resetIfNeeded();
    const input = integerAtLeast(inputTokens, 'input_tokens');
    const output = integerAtLeast(outputTokens, 'output_tokens');
    const cost = finiteNonNegative(costUsd, 'cost_usd');
    if (input > this.limits.maxInputTokens) throw new Error('model_input_token_limit');
    if (output > this.limits.maxOutputTokens) throw new Error('model_output_token_limit');
    if (cost > this.limits.maxRequestCostUsd) throw new Error('model_request_cost_limit');
    const reservation = reservationId ? this.reservations.get(reservationId) : undefined;
    if (reservation !== undefined) this.release(reservationId);
    if (this.spentUsd + cost > this.limits.dailyBudgetUsd) throw new Error('model_daily_budget_exceeded');
    this.spentUsd = Number((this.spentUsd + cost).toFixed(8));
    this.requests += 1;
  }

  snapshot() {
    this.resetIfNeeded();
    return {
      day: this.day,
      spentUsd: this.spentUsd,
      reservedUsd: this.reservedUsd,
      availableUsd: Number(Math.max(0, this.limits.dailyBudgetUsd - this.spentUsd - this.reservedUsd).toFixed(8)),
      requests: this.requests,
      limits: { ...this.limits }
    };
  }
}

export class ModelProviderRegistry {
  constructor({ providers = [], defaultProvider = 'local.echo', costController, clock = () => Date.now() } = {}) {
    this.providers = new Map();
    this.defaultProvider = defaultProvider;
    this.costController = costController || new CostController();
    this.clock = clock;
    for (const provider of providers) this.register(provider);
  }

  register(provider) {
    if (!provider || typeof provider !== 'object' || !NAME.test(provider.name || '') || typeof provider.generate !== 'function') throw new Error('invalid_model_provider');
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
        latencyMs: Math.max(0, this.clock() - startedAt)
      };
    } catch (error) {
      this.costController.release(reservationId);
      throw error;
    }
  }

  budget() { return this.costController.snapshot(); }
}

export const localEchoProvider = {
  name: 'local.echo',
  model: 'deterministic-echo-v1',
  description: 'Offline deterministic provider for development, tests and safe fallback operation.',
  pricing: { inputPerMillionTokens: 0, outputPerMillionTokens: 0 },
  async generate({ messages }) {
    const last = messages[messages.length - 1];
    return { text: last.content, usage: { inputTokens: estimatePromptTokens(messages), outputTokens: estimateTokens(last.content) } };
  }
};

export function createModelRegistry({ env = process.env } = {}) {
  const costController = new CostController({
    limits: {
      maxInputTokens: env.OMNI_BRAIN_MODEL_MAX_INPUT_TOKENS || DEFAULT_LIMITS.maxInputTokens,
      maxOutputTokens: env.OMNI_BRAIN_MODEL_MAX_OUTPUT_TOKENS || DEFAULT_LIMITS.maxOutputTokens,
      maxRequestCostUsd: env.OMNI_BRAIN_MODEL_MAX_REQUEST_COST_USD ?? DEFAULT_LIMITS.maxRequestCostUsd,
      dailyBudgetUsd: env.OMNI_BRAIN_MODEL_DAILY_BUDGET_USD ?? DEFAULT_LIMITS.dailyBudgetUsd,
      providerTimeoutMs: env.OMNI_BRAIN_MODEL_PROVIDER_TIMEOUT_MS ?? DEFAULT_LIMITS.providerTimeoutMs
    }
  });
  return new ModelProviderRegistry({ providers: [localEchoProvider], defaultProvider: env.OMNI_BRAIN_DEFAULT_MODEL_PROVIDER || 'local.echo', costController });
}
