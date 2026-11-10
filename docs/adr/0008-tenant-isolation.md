# ADR 0008: Two-layer tenant isolation (D8)

- **Status:** Accepted
- **Date:** 2026-11-10
- **Roadmap ref:** roadmap-v2.md §2

## Context

Cross-tenant leaks are a fatal risk.

## Decision

Layer 1: repositories scope every query by org (Prisma client extension). Layer 2: Postgres row-level security using `SET LOCAL app.org_id` inside each transaction. The app connects as a non-owner role so RLS applies. Built in P2.

## Consequences

Every request touching tenant data runs inside a transaction. An automated route-coverage isolation suite is a CI gate.
