# Phase report — P2 Identity and access

- **Date:** 2026-11-10
- **Status:** Complete, pending review. One exit gate needs a human: the ASVS checklist sign-off.

## Exit gates

| Gate | Status | Evidence |
|---|---|---|
| Isolation suite covers 100 % of routes, 0 failures | Pass | `apps/api/tests/isolation.test.ts` reads every operation from OpenAPI; fails on any route without `x-access`. Injecting a membership-check bug made it fail (then reverted). |
| Auth flows pass E2E | Pass | `apps/web/e2e/auth.e2e.ts`: sign-up → email verification → create org → invite → colleague joins as viewer; password reset by email; signed-out redirect |
| Cookies `HttpOnly; Secure; SameSite=Lax`; CSRF on cookie mutations | Pass | Identity tests (cookie flags, foreign-origin auth call → 403, cross-origin form post → 403) |
| ASVS L2 auth subset signed off | **Needs reviewer** | `docs/security/asvs-l2-auth-checklist.md` (self-assessed: 1 not met — breached-password check) |

| NECESSARY item | Status |
|---|---|
| TOTP MFA, mandatory for platform admins | Done (enrol, verify, backup codes, sign-in challenge; platform routes 403 `MFA_REQUIRED` without it) |
| Account data export and deletion (GDPR) | Done (`GET /api/v1/me/export`; delete blocked for sole owners) |

## Built

**Database**
- Better Auth tables (user, session, account, verification, organisation, member, invitation, two_factor, rate_limit) plus `login_throttle`. UUIDv7 IDs.
- Non-owner runtime role `casitrace_app` (NOBYPASSRLS); migrations run as owner via `MIGRATE_DATABASE_URL`. Fixes P1 audit note 1.
- RLS on `audit_log` keyed on `app.org_id`; `withTenant`, `withPlatformAccess`; `runCommand` sets the scope.
- `bun run db:setup`: creates the test DB, migrates both DBs, sets the runtime login.

**API**
- Everything under `/api` (ADR 0014). Better Auth at `/api/v1/auth` with organisations, invitations, role templates (owner, admin, operator, reviewer, viewer), TOTP, DB rate limits, lockout, audit after-hook, emails via outbox.
- `withAccess` route guards that also publish `x-access` in OpenAPI. Routes: `GET /v1/me`, `GET /v1/me/export`, `GET /v1/orgs/{orgId}`, `GET /v1/orgs/{orgId}/audit-log` (cursor pagination), `GET /v1/platform/organizations`.
- Non-members get 404 on organisation routes; platform routes 404 for non-staff.
- Hono CSRF + 1 MB body limit on `/api/v1`; HTTP errors mapped to the standard envelope.

**Worker**
- SMTP email sending (verification, reset, invitation templates; HTML-escaped). Links are redacted from the outbox after sending.

**Web**
- Sign-up, check-email, sign-in, two-factor step, forgot/reset password, home (organisations + create), organisation page (members, invite, pending invitations, audit log by permission), accept invitation, account (two-factor setup/disable, download data, delete account), organisation switcher, status page.

## Test results (local)

| Suite | Result |
|---|---|
| Lint / typecheck / build | Pass |
| Backend (`bun run test`) | 59 pass, 0 fail (11 files) |
| E2E (`bun run e2e`) | 4 pass |

## Decisions and deviations

- ADR 0009 accepted (Better Auth); ADR 0008 amended (runtime role, RLS scope); ADR 0014 added (`/api` layout).
- Identity tables are not under RLS (Better Auth queries them outside our transactions); covered by app-layer checks and the isolation suite instead.
- UI uses small in-house Tailwind components; shadcn/ui not adopted yet.

## Known limitations

1. No UI to change a member's role, remove members or transfer ownership (the API supports it via Better Auth; owners can't do it from the web yet).
2. Platform roles can only be granted directly in the database. There is no admin console (not in P2 scope).
3. No session list / "sign out other devices" UI.
4. Breached-password check not enabled.
5. Per-IP rate limits trust `X-Forwarded-For`; the production proxy must overwrite it (P9).
6. CI has still not run on GitHub (no remote).

## Next: P3 — Master data

Blocked on the owner's Phase 0 decisions: pilot commodity (ADR 0001) and jurisdiction (ADR 0002).
