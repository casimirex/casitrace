# ADR 0007: Append-only events with correction events (D7)

- **Status:** Accepted
- **Date:** 2026-11-10
- **Roadmap ref:** roadmap-v2.md §2

## Context

Traceability and audit records must not be silently rewritten, but data-entry mistakes must be fixable.

## Decision

Events and audit rows are append-only, enforced by a database trigger that rejects UPDATE and DELETE. Mistakes are fixed by a VOID/correction event that references the original. Each event has occurredAt (business time) and recordedAt (system time).

## Consequences

Current state is derived from the event history. The trigger exists from P1 on the audit log.
