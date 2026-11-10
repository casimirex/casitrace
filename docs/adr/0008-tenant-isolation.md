# ADR 0008: Two-layer tenant isolation (D8)

- **Status:** Accepted (amended in P2)
- **Date:** 2026-11-10
- **Roadmap ref:** roadmap-v2.md §2

## Context

Cross-tenant leaks are a fatal risk.

## Decision

Layer 1: repositories scope every query by org (Prisma client extension). Layer 2: Postgres row-level security using `SET LOCAL app.org_id` inside each transaction. The app connects as a non-owner role so RLS applies. Built in P2.

## Consequences

Every request touching tenant data runs inside a transaction. An automated route-coverage isolation suite is a CI gate.

## Amendment (P2, 2026-11-10)

- Runtime role `casitrace_app` is created by migration as NOLOGIN, NOBYPASSRLS and owns nothing; its login password is set outside migrations (`scripts/db-setup.ts` locally, secrets manager in production). Migrations run as the owner through `MIGRATE_DATABASE_URL`.
- RLS applies to **tenant-owned business tables** (those with `org_id`), starting with `audit_log`. Policies read `app.org_id` set by `withTenant()`/`runCommand()`, or `app.platform_access` set by `withPlatformAccess()` for audited staff reads.
- Identity tables (`user`, `session`, `member`, `invitation`, …) are not under RLS because Better Auth queries them outside our transactions. They are protected at the application layer and by the isolation suite, which includes attacks through Better Auth's organisation endpoints.
- Organisation routes are `/api/v1/orgs/{orgId}/…`. A non-member gets 404 (not 403) so organisation IDs cannot be probed.
- RLS guards against forgotten scoping, not against SQL injection: the app role can set its own GUCs.
