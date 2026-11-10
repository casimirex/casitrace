# ADR 0003: Organisation is the tenant (D3)

- **Status:** Accepted
- **Date:** 2026-11-10
- **Roadmap ref:** roadmap-v2.md §2

## Context

v1 listed both Tenant and Organization without distinguishing them.

## Decision

There is no separate Tenant entity. Every tenant-owned row carries `org_id`. A user can belong to many organisations.

## Consequences

One concept to enforce. Enterprise groups of organisations, if ever needed, become a grouping above Organization.
