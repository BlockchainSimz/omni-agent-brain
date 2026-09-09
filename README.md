# Omni Agent Brain

A provenance-aware foundation for a self-improving AI agent brain.

## Current status

**v0.7.0 production foundation — Phase 14 evaluation/benchmark service.** The repository contains an executable core, hardened HTTP API, PostgreSQL persistence, async concurrency controls, provenance tracking, guarded skill promotion, rollback support, authentication, rate limiting, idempotency, production Docker support, deterministic semantic retrieval, PostgreSQL/pgvector-backed vector search, separated episodic/semantic/procedural/working memory, controlled source-ingestion adapters, and reproducible evaluation infrastructure.

The service is a hardened foundation, not a complete autonomous AI platform. External learning, model orchestration, production-grade embedding providers, sandboxed execution, and distributed infrastructure remain roadmap work.

## Evaluation and benchmarks

Phase 14 adds a deterministic evaluation service for reproducible capability testing:

- Dataset definitions have explicit IDs, versions, bounded case counts, and deterministic SHA-256 dataset hashes.
- Cases support exact, substring, regular-expression, and numeric-tolerance matchers.
- Evaluations return per-case results plus aggregate score, pass threshold, and regression rate.
- Baselines can be supplied to detect previously passing cases that regress.
- Evaluation IDs are deterministic for the same dataset and outputs.
- Evaluation is intentionally separate from model execution: callers supply outputs, keeping the benchmark engine deterministic and safe to run in CI.
- The authenticated HTTP endpoint `/v1/evaluations/run` exposes the benchmark service through the same request-size, authentication, rate-limit, and idempotency controls as other write endpoints.

A benchmark can therefore be committed as a reproducible dataset and used as an objective gate before a candidate capability is promoted.

## Source ingestion

Phase 13 adds a dedicated GitHub source adapter for approved knowledge ingestion:

- Fetch individual files from public or token-authenticated GitHub repositories through the GitHub REST API.
- Preserve repository, path, Git object SHA, ref, source URL, and content hash as provenance metadata.
- Apply bounded request timeouts and a maximum file-size limit.
- Reject unsafe repository/path inputs and path traversal.
- Support single-file and bounded batch ingestion.
- Isolate failures in batch ingestion instead of aborting all sources.
- Route ingested content through the existing `KnowledgeService`/learning pipeline so validation, confidence, provenance, embeddings, and audit semantics remain centralized.
- Expose authenticated HTTP endpoints at `/v1/sources/github/file` and `/v1/sources/github/batch`.
- Use `GITHUB_TOKEN` or `OMNI_BRAIN_GITHUB_TOKEN` when authenticated GitHub API access is configured; public repository reads can operate without a token subject to GitHub API limits.

The GitHub REST API supports repository-content retrieval and documented rate-limit controls. citeturn0search0turn0search9

### Example request

```json
{
  "repository": "owner/repository",
  "path": "docs/architecture.md",
  "ref": "main",
  "trust": "verified",
  "confidence": 0.9
}
```

The adapter deliberately ingests source material as **candidate knowledge**; it does not automatically promote external content into trusted operational behavior.

## Production readiness

Before exposing the service to real traffic:

- Set `NODE_ENV=production`.
- Set a strong `OMNI_BRAIN_API_KEY` through the deployment secret manager; never commit it.
- Set `OMNI_BRAIN_DATABASE_URL` to a production PostgreSQL instance with the `vector` extension available.
- Optionally set `GITHUB_TOKEN` or `OMNI_BRAIN_GITHUB_TOKEN` for authenticated GitHub source ingestion.
- Optionally set `OMNI_BRAIN_DATABASE_TABLE`, `OMNI_BRAIN_VECTOR_TABLE`, `OMNI_BRAIN_RATE_LIMIT_TABLE`, and `OMNI_BRAIN_IDEMPOTENCY_TABLE` to validated PostgreSQL identifiers.
- Put TLS and a trusted reverse proxy/load balancer in front of the service.
- Configure `PORT` and rate/idempotency limits for the deployment size.
- Treat `/health` as the container liveness check and `/ready` as the service readiness endpoint.
- Back up and validate persistent storage before enabling production data workloads.

## Memory architecture

The brain exposes explicit memory classes:

- **Episodic** — time-bound observations and events.
- **Semantic** — durable facts and validated knowledge.
- **Procedural** — knowledge tied to an explicit skill identifier.
- **Working** — temporary context with a bounded TTL and deterministic expiry/pruning.

All memory classes retain the existing provenance, confidence, validation, embedding, audit, and persistence contracts. Working memories are excluded from retrieval after expiry and from PostgreSQL vector synchronization/search after expiry.

## Semantic retrieval

Memories carry deterministic 256-dimensional embeddings generated from hashed word, word-bigram, and character-trigram features. PostgreSQL deployments persist active memory embeddings in a `pgvector` table and use cosine-distance search; the service falls back to the in-memory retrieval implementation if the vector backend is temporarily unavailable. The vector index is HNSW-backed for scalable approximate nearest-neighbor search.

The embedding implementation is intentionally dependency-free and deterministic. It is a foundation for later replacement with a model-backed embedding provider; it should not be described as equivalent to a neural embedding model.

## Implemented

- Candidate memory with source provenance and source hashing
- Explicit episodic, semantic, procedural, and working-memory APIs
- Working-memory TTL enforcement and pruning
- Confidence and validation state
- Deterministic vector embeddings and cosine-similarity retrieval
- PostgreSQL/pgvector persistent vector storage and HNSW retrieval
- Vector synchronization after persistent brain writes with graceful fallback
- GitHub source ingestion with commit-level provenance
- Candidate knowledge ingestion through the central learning pipeline
- Reproducible evaluation datasets and deterministic benchmark scoring
- Exact, contains, regex, and numeric-tolerance benchmark matchers
- Baseline regression detection for previously passing cases
- Candidate skill registry
- Promotion gates: passing evaluation, score >= 0.8, zero regression rate
- Explicit rollback/deprecation
- Request-size limit and structured API errors
- Authentication required in production
- Request correlation IDs and runtime observability
- Bounded rate-limit and idempotency state with expiry cleanup
- HTTP method/content-type validation and security response headers
- HTTP request/header/keep-alive timeouts and graceful shutdown
- Health and readiness endpoints
- Concurrent HTTP load smoke test
- Node.js test suite and GitHub Actions CI with dependency auditing
- Non-root production Docker image with a container healthcheck
- Production JSON persistence with schema validation and atomic writes
- PostgreSQL persistence adapter with parameterized state writes, schema-version checks, identifier validation, and healthcheck
- Async PostgreSQL-backed brain integration with serialized writes and rollback-on-failure semantics
- Security policy for untrusted external content and self-modification

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
POST /v1/skills
POST /v1/skills/:id/promote
POST /v1/skills/:id/rollback
```

## Production container

```bash
docker build --pull -t omni-agent-brain .
docker run --rm -p 3000:3000 \
  -e NODE_ENV=production \
  -e OMNI_BRAIN_API_KEY='set-this-through-your-secret-manager' \
  -e OMNI_BRAIN_DATABASE_URL='postgres://USER:PASSWORD@HOST:5432/omni_brain' \
  -e GITHUB_TOKEN='set-this-through-your-secret-manager' \
  omni-agent-brain
```

The image runs as the non-root `node` user and exposes a Docker healthcheck against `/health`. Do not put secrets in the Dockerfile, image, repository, or command history in a shared environment.

## Evolution roadmap

1. ~~Persistent PostgreSQL storage and migrations~~ — async integration completed
2. ~~Vector/semantic retrieval layer~~ — persistent pgvector integration completed
3. ~~Episodic, semantic, procedural and working-memory stores~~ — typed memory layer completed
4. ~~Source ingestion adapters for GitHub and approved knowledge sources~~ — GitHub adapter completed; additional approved providers remain
5. ~~Evaluation/benchmark service with reproducible datasets~~ — deterministic benchmark engine and regression detection completed
6. Sandboxed code/tool execution
7. Model/provider abstraction and cost controls
8. ~~Distributed observability, rate limiting and idempotency~~ — foundation completed
9. Automated freshness/knowledge-decay jobs
10. Human approval controls for high-impact capability changes
11. Production model-backed embeddings and vector lifecycle management

See [`SECURITY.md`](SECURITY.md) for the self-modification and provenance policy.
