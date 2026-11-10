# ADR 0009: Use a maintained auth library (D9)

- **Status:** Accepted (P2, 2026-11-10)
- **Date:** 2026-11-10
- **Roadmap ref:** roadmap-v2.md §2

## Context

Hand-rolled auth is a common source of vulnerabilities.

## Decision

Better Auth 1.7 with its Prisma adapter (Prisma 7 is a supported peer), the organisation plugin (members, invitations, role-based access control) and the two-factor plugin (TOTP, backup codes). Mounted at `/api/v1/auth` inside the Hono app.

Configuration decisions:
- Email + password only; email verification required before sign-in; passwords 12–128 characters.
- Secure, HttpOnly, SameSite=Lax cookies; sessions 7 days, refreshed daily; "fresh" window 15 minutes.
- Origin/CSRF checks set explicitly on, because Better Auth disables them when `NODE_ENV=test`.
- Rate limits stored in Postgres (sign-in 10/min, sign-up 5/min, reset 3/min per IP).
- Account lockout is ours (Better Auth has none for passwords): 5 failures → 15 minutes, keyed by email hash, applied to unknown emails too.
- IDs are UUIDv7 via `generateId`; invitations therefore require a verified email to accept.
- Roles and permissions live in `@casitrace/contracts` and are shared by Better Auth, the API's `can()` check and the web app.
- Every successful mutating auth endpoint, and every failed sign-in, writes an audit record from an after-hook.
- Emails are queued through the outbox and sent by the worker.

## Consequences

Security-critical flows (hashing, sessions, reset tokens, TOTP) are not written from scratch. Trade-off: Better Auth writes its own rows outside our `runCommand` transaction, so auth audit records are written right after the change rather than atomically with it; a failure to write is logged at error level.
