# Omni Agent Brain

A provenance-aware foundation for a self-improving AI agent brain.

## Current status

**v0.8.0 production foundation — Phase 15 constrained safe tool execution.** The repository contains an executable core, hardened HTTP API, PostgreSQL persistence, async concurrency controls, provenance tracking, guarded skill promotion, rollback support, authentication, rate limiting, idempotency, production Docker support, deterministic semantic retrieval, PostgreSQL/pgvector-backed vector search, separated episodic/semantic/procedural/working memory, controlled source-ingestion adapters, reproducible evaluation infrastructure, and a constrained tool-execution layer.

The service is a hardened foundation, not a complete autonomous AI platform. External learning, model orchestration, production-grade embedding providers, and distributed infrastructure remain roadmap work.

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

This boundary is intentional. Node's `node:vm` documentation explicitly warns that VM contexts are not a security mechanism for untrusted code, and Node's VFS documentation likewise warns that its virtual filesystem is not a security boundary. citeturn0search1turn0search2 Node worker threads provide resource limits, but they are still within the host process; a future truly untrusted-code runner should use OS/container isolation rather than treating an in-process JavaScript context as a sandbox. citeturn0search0

### API

```text
GET  /v1/tools
POST /v1/tools/execute
POST /v1/tools/execute-batch
```

Example single-tool request:

```json
{
  "tool": "math.add",
  "input": { "a": 2, "b": 3 }
}
```

The response includes the result plus execution provenance. Tool names and inputs are validated before dispatch; unknown operations are rejected.

## Evaluation and benchmarks

Phase 14 adds a deterministic evaluation service for reproducible capability testing:

- Dataset definitions have explicit IDs, versions, bounded case counts, and deterministic SHA-256 dataset hashes.
- Cases support exact, substring, regular-expression, and numeric-tolerance matchers.
- Evaluations return per-case results plus aggregate score, pass threshold, and regression rate.
- Baselines can be supplied to detect previously passing cases that regress.
- Evaluation IDs are deterministic for the same dataset and outputs.
- Evaluation is intentionally separate from model execution: callers supply outputs, keeping the benchmark engine deterministic and safe to run in CI.
- The authenticated HTTP endpoint `/v1/evaluations/run` exposes the benchmark service through the same request-size, authentication, rate-limit, and idempotency controls as other write endpoints.

## Production readiness

Before exposing the service to real traffic:

- Set `NODE_ENV=production`.
- Set a strong `OMNI_BRAIN_API_KEY` through the deployment secret manager; never commit it.
- Set `OMNI_BRAIN_DATABASE_URL` to a production PostgreSQL instance with the `vector` extension available.
- Optionally set `GITHUB_TOKEN` or `OMNI_BRAIN_GITHUB_TOKEN` for authenticated GitHub source ingestion.
- Put TLS and a trusted reverse proxy/load balancer in front of the service.
- Configure `PORT` and rate/idempotency limits for the deployment size.
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
7. Model/provider abstraction and cost controls
8. ~~Distributed observability, rate limiting and idempotency~~ — foundation completed
9. Automated freshness/knowledge-decay jobs
10. Human approval controls for high-impact capability changes
11. Production model-backed embeddings and vector lifecycle management

See [`SECURITY.md`](SECURITY.md) for the self-modification and provenance policy.
