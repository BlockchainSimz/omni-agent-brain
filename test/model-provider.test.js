import test from 'node:test';
import assert from 'node:assert/strict';
import { CostController, ModelProviderRegistry, calculateCostUsd, estimatePromptTokens, localEchoProvider } from '../src/model-provider.js';

test('model registry exposes deterministic provider and usage', async () => {
  const registry = new ModelProviderRegistry({ providers: [localEchoProvider] });
  const result = await registry.generate({ messages: [{ role: 'user', content: 'hello brain' }], maxOutputTokens: 32 });
  assert.equal(result.provider, 'local.echo');
  assert.equal(result.model, 'deterministic-echo-v1');
  assert.equal(result.text, 'hello brain');
  assert.equal(result.usage.costUsd, 0);
  assert.equal(registry.budget().requests, 1);
});

test('cost controller rejects requests above token and daily budgets', () => {
  const controller = new CostController({ limits: { maxInputTokens: 10, maxOutputTokens: 5, maxRequestCostUsd: 0.02, dailyBudgetUsd: 0.03 } });
  assert.throws(() => controller.preflight({ inputTokens: 11, maxOutputTokens: 1, estimatedCostUsd: 0 }), /model_input_token_limit/);
  assert.throws(() => controller.preflight({ inputTokens: 1, maxOutputTokens: 6, estimatedCostUsd: 0 }), /model_output_token_limit/);
  assert.throws(() => controller.preflight({ inputTokens: 1, maxOutputTokens: 1, estimatedCostUsd: 0.03 }), /model_request_cost_limit/);
  controller.commit({ inputTokens: 1, outputTokens: 1, costUsd: 0.02 });
  assert.throws(() => controller.preflight({ inputTokens: 1, maxOutputTokens: 1, estimatedCostUsd: 0.011 }), /model_daily_budget_exceeded/);
});

test('cost reservations prevent concurrent budget overspend', () => {
  const controller = new CostController({ limits: { maxInputTokens: 10, maxOutputTokens: 10, maxRequestCostUsd: 0.02, dailyBudgetUsd: 0.02 } });
  const first = controller.preflight({ inputTokens: 1, maxOutputTokens: 1, estimatedCostUsd: 0.02 });
  assert.equal(controller.snapshot().reservedUsd, 0.02);
  assert.throws(() => controller.preflight({ inputTokens: 1, maxOutputTokens: 1, estimatedCostUsd: 0.01 }), /model_daily_budget_exceeded/);
  controller.commit({ inputTokens: 1, outputTokens: 1, costUsd: 0.015, reservationId: first });
  assert.equal(controller.snapshot().spentUsd, 0.015);
  assert.equal(controller.snapshot().reservedUsd, 0);
});

test('token estimation and pricing are deterministic', () => {
  const messages = [{ role: 'user', content: '12345678' }];
  assert.equal(estimatePromptTokens(messages), 6);
  assert.equal(calculateCostUsd({ inputTokens: 1000, outputTokens: 500 }, { inputPerMillionTokens: 2, outputPerMillionTokens: 4 }), 0.004);
});

test('provider output and request limits fail closed', async () => {
  const provider = { ...localEchoProvider, name: 'test.limit', async generate() { return { text: 'x'.repeat(300_000), usage: { inputTokens: 1, outputTokens: 1 } }; } };
  const registry = new ModelProviderRegistry({ providers: [provider] });
  await assert.rejects(() => registry.generate({ provider: 'test.limit', messages: [{ role: 'user', content: 'x' }] }), /model_output_too_large/);
  assert.equal(registry.budget().reservedUsd, 0);
});

test('provider execution is bounded by the configured timeout', async () => {
  const provider = {
    ...localEchoProvider,
    name: 'test.timeout',
    async generate() { await new Promise(resolve => setTimeout(resolve, 50)); return { text: 'late' }; }
  };
  const controller = new CostController({ limits: { providerTimeoutMs: 10 } });
  const registry = new ModelProviderRegistry({ providers: [provider], costController: controller });
  await assert.rejects(() => registry.generate({ provider: 'test.timeout', messages: [{ role: 'user', content: 'x' }] }), /model_provider_timeout/);
  assert.equal(registry.budget().reservedUsd, 0);
});
