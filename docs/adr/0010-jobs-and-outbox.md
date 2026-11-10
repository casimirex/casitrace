# ADR 0010: Postgres-backed jobs and transactional outbox (D10)

- **Status:** Accepted
- **Date:** 2026-11-10
- **Roadmap ref:** roadmap-v2.md §2

## Context

Events must be published reliably after a commit, and the MVP should run with as little infrastructure as possible.

## Decision

Commands write an `outbox_event` row in the same transaction as their state change. The worker relays unpublished rows to pg-boss queues (row lock with SKIP LOCKED) and marks them published. Redis is not used in the MVP.

## Consequences

At-least-once delivery: job handlers must be idempotent (keyed by outbox event ID).
