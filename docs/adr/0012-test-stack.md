# ADR 0012: Test stack (D12)

- **Status:** Accepted (amended)
- **Date:** 2026-11-10
- **Roadmap ref:** roadmap-v2.md §2

## Context

One unit runner, real Postgres for integration tests, browser E2E.

## Decision

`bun test` is the single unit and integration runner. Integration tests use the Docker Compose Postgres with a dedicated `casitrace_test` database, migrated before the run (amended from Testcontainers: simpler and identical in CI, where Compose also runs). Playwright runs E2E.

## Consequences

Tests run under Bun, so Bun APIs (S3, UUIDv7) are available in tests.
