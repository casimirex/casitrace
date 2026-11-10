# ADR 0009: Use a maintained auth library (D9)

- **Status:** Proposed — confirm in P2
- **Date:** 2026-11-10
- **Roadmap ref:** roadmap-v2.md §2

## Context

Hand-rolled auth is a common source of vulnerabilities.

## Decision

Use a maintained library with a Prisma adapter and organisation support (candidate: Better Auth). Final choice made at the start of P2 after checking Bun + Hono compatibility.

## Consequences

Security-critical flows (hashing, sessions, reset tokens) are not written from scratch.
