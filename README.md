# Omni Agent Brain

A provenance-aware foundation for a self-improving AI agent brain.

## Current status

**v0.2.0 foundation** — the repository now contains an executable core, HTTP API, tests, CI, provenance tracking, guarded skill promotion, and rollback support. External learning/crawling and persistent database adapters remain planned integrations.

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
- Health and snapshot endpoints
- Node.js test suite and GitHub Actions CI
- Security policy for untrusted external content and self-modification

## API

```text
GET  /health
GET  /v1/snapshot
POST /v1/memories
POST /v1/memories/:id/validate
POST /v1/skills
POST /v1/skills/:id/promote
POST /v1/skills/:id/rollback
```

## Development

Requires Node.js 20+.

```bash
npm test
npm run lint
npm start
```

## Evolution roadmap

1. Persistent PostgreSQL storage and migrations
2. Vector/semantic retrieval layer
3. Episodic, semantic, procedural and working-memory stores
4. Source ingestion adapters for GitHub and approved knowledge sources
5. Evaluation/benchmark service with reproducible datasets
6. Sandboxed code/tool execution
7. Model/provider abstraction and cost controls
8. Observability, rate limiting, authentication and authorization
9. Automated freshness/knowledge-decay jobs
10. Human approval controls for high-impact capability changes

See [`SECURITY.md`](SECURITY.md) for the self-modification and provenance policy.
