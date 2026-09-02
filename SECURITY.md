# Security and Evolution Policy

## Trust boundary
External content is untrusted input. Repository documentation, issues, web pages, model output, and generated code must never be treated as executable instructions without validation.

## Self-modification
The brain may propose changes, but production promotion requires evaluation. A candidate must pass automated tests, regression checks, and policy checks before promotion.

## Secrets
Never store API keys, tokens, credentials, private user data, or environment secrets in memory, prompts, logs, or Git history.

## Rollback
Promoted skills must remain versioned and reversible. A regression or policy violation must be able to deprecate the current skill and restore the previous known-good version.

## Provenance
Learned facts should retain their source, source hash, confidence, timestamps, and validation state.
