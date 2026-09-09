# Omni Agent Brain

A provenance-aware foundation for a self-improving AI agent brain.

## Current status

**v0.5.0 production foundation — Phase 12 typed memory stores.** The repository contains an executable core, hardened HTTP API, PostgreSQL persistence, async concurrency controls, provenance tracking, guarded skill promotion, rollback support, authentication, rate limiting, idempotency, production Docker support, deterministic semantic retrieval, PostgreSQL/pgvector-backed vector search, and separated episodic, semantic, procedural, and working-memory abstractions.

The service is a hardened foundation, not a complete autonomous AI platform. External learning, model orchestration, production-grade embedding providers, sandboxed execution, and distributed infrastructure remain roadmap work.

## Production readiness

Before exposing the service to real traffic:

- Set `NODE_ENV=production`.
- Set a strong `OMNI_BRAIN_API_KEY` through the deployment secret manager; never commit it.
- Set `OMNI_BRAIN_DATABASE_URL` to a production PostgreSQL instance with the `vector` extension available.
- Optionally set `OMNI_BRAIN_DATABASE_TABLE`, `OMNI_BRAIN_VECTOR_TABLE`, `OMNI_BRAIN_RATE_LIMIT_TABLE`, and `OMNI_BRAIN_IDEMPOTENCY_TABLE` to validated PostgreSQL identifiers.
- Put TLS and a trusted reverse proxy/load balancer in front of the service.
- Configure `PORT` and rate/idempotency limits for the deployment size.
- Treat `/health` as the container liveness check and `/ready` as the service readiness endpoint.
- Back up and validate persistent storage before enabling production data workloads.

## Memory architecture

The brain now exposes explicit memory classes:

- **Episodic** — time-bound observations and events.
- **Semantic** — durable facts and validated knowledge.
- **Procedural** — knowledge tied to an explicit skill identifier.
- **Working** — temporary context with a bounded TTL and deterministic expiry/pruning.

All memory classes retain the existing provenance, confidence, validation, embedding, audit, and persistence contracts. Working memories are excluded from retrieval after expiry and from PostgreSQL vector synchronization/search after expiry.

## Semantic retrieval

Memories carry deterministic 256-dimensional embeddings generated from hashed word, word-bigram, and character-trigram features. PostgreSQL deployments persist active memory embeddings in a `pgvector` table and use cosine-distance search; the service falls back to the in-memory retrieval implementation if the vector backend is temporarily unavailable. The vector index is HNSW-backed for scalable approximate nearest-neighbor search. citeturn0search0

The embedding implementation is intentionally dependency-free and deterministic. It is a foundation for later replacement with a model-backed embedding provider; it should not be described as equivalent to a neural embedding model.

## Architecture

```text
External observations
        |
        v
  Episodic / Semantic / Working memory
        |             |
        |             +---- TTL expiry/pruning
        v
     embedding ---> pgvector/HNSW ---> semantic retrieval
        |
        v
 validated knowledge ---> Procedural memory ---> skill registry
        |
 Candidate skill ---> evaluation ---> promotion ---> versioning
                              |                         |
                              +------ regression <------+
                                         |
                                      rollback
```

## Implemented

- Candidate memory with source provenance and source hashing
- Explicit episodic, semantic, procedural, and working-memory APIs
- Working-memory TTL enforcement and pruning
- Confidence and validation state
- Deterministic vector embeddings and cosine-similarity retrieval
- PostgreSQL/pgvector persistent vector storage and HNSW retrieval
- Vector synchronization after persistent brain writes with graceful fallback
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

The CI PostgreSQL service uses a pgvector-enabled PostgreSQL image so the real vector integration tests exercise the same extension required by the application. citeturn0search0

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
  omni-agent-brain
```

The image runs as the non-root `node` user and exposes a Docker healthcheck against `/health`. Do not put secrets in the Dockerfile, image, repository, or command history in a shared environment.

## Evolution roadmap

1. ~~Persistent PostgreSQL storage and migrations~~ — async integration completed
2. ~~Vector/semantic retrieval layer~~ — persistent pgvector integration completed
3. ~~Episodic, semantic, procedural and working-memory stores~~ — typed memory layer completed
4. Source ingestion adapters for GitHub and approved knowledge sources
5. Evaluation/benchmark service with reproducible datasets
6. Sandboxed code/tool execution
7. Model/provider abstraction and cost controls
8. ~~Distributed observability, rate limiting and idempotency~~ — foundation completed
9. Automated freshness/knowledge-decay jobs
10. Human approval controls for high-impact capability changes
11. Production model-backed embeddings and vector lifecycle management

See [`SECURITY.md`](SECURITY.md) for the self-modification and provenance policy.
