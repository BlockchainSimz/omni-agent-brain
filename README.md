# Omni Agent Brain

A provenance-aware foundation for a self-improving AI agent brain.

## Current status

**v0.9.0 production foundation — Phase 16 model/provider abstraction and cost controls.** The repository contains an executable core, hardened HTTP API, PostgreSQL persistence, async concurrency controls, provenance tracking, guarded skill promotion, rollback support, authentication, rate limiting, idempotency, production Docker support, deterministic semantic retrieval, PostgreSQL/pgvector-backed vector search, separated episodic/semantic/procedural/working memory, controlled source-ingestion adapters, reproducible evaluation infrastructure, constrained tool execution, and a provider-neutral model execution layer with fail-closed token/cost budgets.

The service is a hardened foundation, not a complete autonomous AI platform. External model-provider adapters, automated freshness jobs, human approval controls, and production model-backed embeddings remain roadmap work.

## Model/provider abstraction and cost controls

Phase 16 provides a provider-neutral model interface without coupling the core to a specific commercial model vendor. Providers are trusted server-side adapters; callers cannot register or execute provider code through the HTTP API.

The default `local.echo` provider is deterministic, offline, and free, making development and CI reproducible. External providers can be added later behind the same `ModelProviderRegistry` contract without changing the API surface.

### Model API

```text
GET  /v1/models
GET  /v1/models/budget
POST /v1/models/generate
```

`POST /v1/models/generate` accepts a bounded message array and optional provider/output-token settings. Responses include provider/model identity, request ID, measured usage, calculated cost and latency. Model generation is protected by the existing authentication, rate-limit and idempotency controls.

### Cost and execution controls

The model layer performs a preflight budget check **before** provider execution and reserves the estimated request cost. This reservation prevents concurrent requests from racing past the daily budget. Successful execution reconciles the reservation against authoritative provider usage; failed or timed-out execution releases the reservation.

Every provider call also has a configurable execution timeout and receives an `AbortSignal` so future adapters can cancel upstream work. Output size, input tokens, output tokens, request cost and daily budget all fail closed when limits are exceeded.

Environment variables:

- `OMNI_BRAIN_DEFAULT_MODEL_PROVIDER` — default provider, `local.echo` by default.
- `OMNI_BRAIN_MODEL_MAX_INPUT_TOKENS` — per-request input-token ceiling, default `8192`.
- `OMNI_BRAIN_MODEL_MAX_OUTPUT_TOKENS` — per-request output-token ceiling, default `2048`.
- `OMNI_BRAIN_MODEL_MAX_REQUEST_COST_USD` — maximum calculated cost for one request, default `$1`.
- `OMNI_BRAIN_MODEL_DAILY_BUDGET_USD` — process-local daily spending ceiling, default `$10`.
- `OMNI_BRAIN_MODEL_PROVIDER_TIMEOUT_MS` — provider execution timeout, default `30000ms`, maximum `300000ms`.

The default pricing model is zero-cost because the bundled provider is offline. Provider adapters supply their own input/output price metadata. API responses never expose provider API keys or other secrets.

The daily budget is intentionally process-local in Phase 16; a future distributed budget ledger will be required when multiple application instances must share one hard spending ceiling.

## Constrained tool execution

Phase 15 adds a deliberately narrow execution layer for safe agent tooling. It is **not an arbitrary-code sandbox** and does not execute shell commands, JavaScript supplied by callers, child processes, package installation, or network requests.

The executor provides a small allowlist of pure operations:

- Basic numeric arithmetic with finite-number validation.
- Bounded text length/case/contains operations.
- Bounded JSON path lookup with prototype-pollution path rejection.
- Strict input/output size limits and bounded batch size.
- Per-execution provenance and unique execution IDs.
- Deterministic failure handling for invalid tools and invalid inputs.
- API access through authenticated, rate-limited, idempotent write endpoints.

## Evaluation and benchmarks

Phase 14 adds a deterministic evaluation service for reproducible capability testing. Dataset definitions have explicit IDs and versions, cases support multiple deterministic matchers, baselines detect regressions, and evaluation IDs are deterministic for identical inputs.

## Production readiness

Before exposing the service to real traffic:

- Set `NODE_ENV=production`.
- Set a strong `OMNI_BRAIN_API_KEY` through the deployment secret manager; never commit it.
- Set `OMNI_BRAIN_DATABASE_URL` to a production PostgreSQL instance with the `vector` extension available.
- Optionally set `GITHUB_TOKEN` or `OMNI_BRAIN_GITHUB_TOKEN` for authenticated GitHub source ingestion.
- Put TLS and a trusted reverse proxy/load balancer in front of the service.
- Configure rate, idempotency and model budget limits for the deployment size.
- Treat `/health` as the container liveness check and `/ready` as the service readiness endpoint.
- Back up and validate persistent storage before enabling production data workloads.

## Development

Requires Node.js 20+.

```bash
npm ci
npm test
npm run test:load
npm run test:postgres
npm run lint
npm audit --audit-level=high
npm start
```

## API

```text
GET  /health
GET  /ready
GET  /v1/snapshot
GET  /v1/tools
GET  /v1/models
GET  /v1/models/budget
GET  /v1/memories/search
GET  /v1/knowledge/conflicts
GET  /v1/knowledge/consolidation
POST /v1/memories
POST /v1/memories/:id/validate
POST /v1/knowledge
POST /v1/knowledge/batch
POST /v1/research/url
POST /v1/research/batch
POST /v1/sources/github/file
POST /v1/sources/github/batch
POST /v1/evaluations/run
POST /v1/models/generate
POST /v1/tools/execute
POST /v1/tools/execute-batch
POST /v1/skills
POST /v1/skills/:id/promote
POST /v1/skills/:id/rollback
```

## Evolution roadmap

1. ~~Persistent PostgreSQL storage and migrations~~ — async integration completed
2. ~~Vector/semantic retrieval layer~~ — persistent pgvector integration completed
3. ~~Episodic, semantic, procedural and working-memory stores~~ — typed memory layer completed
4. ~~Source ingestion adapters for GitHub and approved knowledge sources~~ — GitHub adapter completed; additional approved providers remain
5. ~~Evaluation/benchmark service with reproducible datasets~~ — deterministic benchmark engine and regression detection completed
6. ~~Constrained safe tool execution~~ — allowlisted pure operations with bounded inputs/outputs and provenance completed
7. ~~Model/provider abstraction and cost controls~~ — provider registry, deterministic offline provider, reserved token/cost ceilings, request cost ceilings, daily budget controls and provider timeouts completed
8. ~~Distributed observability, rate limiting and idempotency~~ — foundation completed
9. Automated freshness/knowledge-decay jobs
10. Human approval controls for high-impact capability changes
11. Production model-backed embeddings and vector lifecycle management

See [`SECURITY.md`](SECURITY.md) for the self-modification and provenance policy.
