# Omni Agent Brain

A provenance-aware foundation for a self-improving AI agent brain.

## Current status

**v0.2.0 production foundation** — the repository contains an executable core, hardened HTTP API, concurrency smoke testing, CI, provenance tracking, guarded skill promotion, rollback support, runtime observability, authentication, rate limiting, idempotency, and a production container definition. External learning/crawling and persistent database adapters remain planned integrations.

## Production readiness

The current branch is suitable as a hardened service foundation, not as a complete autonomous AI platform. Before exposing it to real traffic:

- Set `NODE_ENV=production`.
- Set a strong `OMNI_BRAIN_API_KEY` through the deployment secret manager; never commit it.
- Put TLS and a trusted reverse proxy/load balancer in front of the service.
- Configure `PORT` and rate/idempotency limits for the deployment size.
- Treat `/health` as the container liveness check and `/ready` as the service readiness endpoint.
- Do not rely on the in-memory rate limiter or idempotency store for correctness across multiple replicas; distributed deployments require a shared store.
- Back up and validate any future persistent storage before enabling production data workloads.

## Architecture

```text
External observations
        |
        v
  Provenance memory ---> validation ---> trusted knowledge
        |
        v
 Candidate skill ---> evaluation ---> promotion ---> versioning
                              |                         |
                              +------ regression <------+ 
                                         |
                                      rollback
```

## Implemented

- Candidate memory with source provenance and source hashing
- Confidence and validation state
- Audit events for memory and skill lifecycle changes
- Candidate skill registry
- Promotion gates: passing evaluation, score >= 0.8, zero regression rate
- Explicit rollback/deprecation
- Request-size limit and structured API errors
- Authentication required in production
- Request correlation IDs and runtime observability
- Bounded rate-limit and idempotency state with expiry cleanup
- HTTP request/header/keep-alive timeouts and graceful shutdown
- Health and readiness endpoints
- Concurrent HTTP load smoke test
- Node.js test suite and GitHub Actions CI with dependency auditing
- Non-root production Docker image with a container healthcheck
- Security policy for untrusted external content and self-modification

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

## Development

Requires Node.js 20+.

```bash
npm ci
npm test
npm run test:load
npm run lint
npm audit --audit-level=high
npm start
```

## Production container

```bash
docker build --pull -t omni-agent-brain .
docker run --rm -p 3000:3000 \
  -e NODE_ENV=production \
  -e OMNI_BRAIN_API_KEY='set-this-through-your-secret-manager' \
  omni-agent-brain
```

The image runs as the non-root `node` user and exposes a Docker healthcheck against `/health`. Do not put secrets in the Dockerfile, image, repository, or command history in a shared environment.

## Evolution roadmap

1. Persistent PostgreSQL storage and migrations
2. Vector/semantic retrieval layer
3. Episodic, semantic, procedural and working-memory stores
4. Source ingestion adapters for GitHub and approved knowledge sources
5. Evaluation/benchmark service with reproducible datasets
6. Sandboxed code/tool execution
7. Model/provider abstraction and cost controls
8. Distributed observability, rate limiting and idempotency
9. Automated freshness/knowledge-decay jobs
10. Human approval controls for high-impact capability changes

See [`SECURITY.md`](SECURITY.md) for the self-modification and provenance policy.
