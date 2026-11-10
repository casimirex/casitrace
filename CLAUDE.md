# Casitrace — rules for Claude Code

Casitrace is a food traceability and evidence platform. The plan is `roadmap-v2.md`; decisions are in `docs/adr/`. `roadmap.md` is the superseded v1, kept for reference.

## How work proceeds

- Implement **one roadmap phase at a time**. Stop at the end of a phase, write `docs/phases/PNN-report.md`, and wait for approval.
- A phase is done only when its exit gates in `roadmap-v2.md` pass. Generated code is not proof; run it.
- Before a phase: read this file, `roadmap-v2.md` (the phase and §2–§4), relevant ADRs, `prisma/schema.prisma`, and the previous phase report.
- A decision that changes an ADR needs a new or amended ADR in the same change.

## Commands

| Task | Command |
|---|---|
| Start services | `docker compose up -d --wait && docker compose up s3-init` |
| Install (also generates Prisma client) | `bun install` |
| Database setup (migrations, runtime role login, test DB) | `bun run db:setup` |
| Run API + worker + web | `bun run dev` (open :5173; API under :5173/api, docs at /api/docs; mail at :8025) |
| New migration | `bun run db:migrate -- --name <name>` then `bun run db:generate` and `bun run db:setup` |
| Tests (backend, test DB) | `bun run test` |
| E2E | `bun run e2e` |
| Lint / format | `bun run lint` / `bun run format` |
| Typecheck | `bun run typecheck` |
| Regenerate API client after route changes | `bun run openapi` (CI fails if stale) |

## Layout

- `apps/api` — Hono HTTP API. `src/modules/<context>/` per bounded context (roadmap-v2 §4.1), each with `domain/`, `application/`, `infrastructure/`, `presentation/` once it has logic. `src/platform/` holds cross-cutting command, audit and outbox code.
- `apps/worker` — outbox relay and pg-boss consumers. Register event handlers in `EventRegistry`.
- `apps/web` — React + Vite. Feature folders under `src/features/`. Talks to the API only through `@casitrace/api-client`.
- `packages/db` — Prisma schema, migrations and client factory. Only infrastructure code imports it.
- `packages/contracts` — Zod schemas shared by routes and OpenAPI.
- `packages/shared` — `AppError`, IDs. No runtime dependencies.
- `packages/api-client` — generated from `openapi.json`. Never edit `schema.d.ts` by hand.

## Non-negotiable rules

1. **Every state change goes through `runCommand`** (`apps/api/src/platform/command.ts`). It requires at least one audit entry and commits audit + outbox with the change.
2. **Append-only tables** (audit log now; events from P5) reject UPDATE/DELETE by trigger. Fix mistakes with correction events, never by editing rows. New append-only tables reuse `casitrace_reject_mutation()` **and** `REVOKE UPDATE, DELETE, TRUNCATE … FROM casitrace_app`.
3. **Tenant isolation** (ADR 0008):
   - Every tenant-owned table has `org_id`, `ENABLE ROW LEVEL SECURITY` and policies using `casitrace_current_org()` (copy the `audit_log` policies in the `identity_access` migration).
   - Read tenant data only inside `withTenant(db, orgId, …)` or `runCommand` (which scopes by `ctx.orgId`). Cross-org staff reads use `withPlatformAccess` and must write an audit record.
   - Every `/api/v1` route is built with `createRoute(withAccess(deps, access, {...}))`. Organisation routes live under `/orgs/{orgId}` and use `{ kind: "org", permission }`. The isolation suite (`apps/api/tests/isolation.test.ts`) reads `x-access` from the OpenAPI document and attacks every route; new path parameters must be added to its `KNOWN_PARAMS`.
   - New permissions go in `packages/contracts/src/permissions.ts` (`statements` + role templates); check them with `can(role, "resource:action")`.
4. **Domain code is framework-free**: no Prisma, Hono, S3 or AI SDK imports in `domain/`. Use ports (see `ObjectStorage`).
5. **Validate every input** with Zod via `@hono/zod-openapi` routes. Responses are explicit DTOs; never return Prisma models directly.
6. **Errors**: throw `AppError` with a code; the HTTP layer maps it to the standard envelope. Never leak internal error text in responses.
7. **IDs** are UUIDv7 from `newId()`. **Quantities** are `Decimal`, never float. **Timestamps** are `timestamptz`, UTC.
8. **Migrations** via `prisma migrate` only; never `db push`. Never edit an applied migration.
9. **Evidence storage is private**. Access only through presigned URLs of at most 15 minutes.
10. **Outbox consumers are idempotent** on `eventId` (delivery is at-least-once).
11. No mock data or fake integrations in production paths. No new dependency without a reason in the phase report.
12. TypeScript strict; no `any`; no non-null assertions without a comment.

## Auth (ADR 0009)

- Better Auth handles sign-up, verification, sessions, password reset, organisations, invitations and TOTP at `/api/v1/auth`. Do not re-implement these.
- Its after-hook in `apps/api/src/modules/identity/auth.ts` audits mutating auth endpoints; add new audited paths to `AUDITED`.
- Emails are queued with `requestEmail()` (outbox) and rendered/sent by the worker (`apps/worker/src/email`). Keep the `EmailRequest` type in both places in sync.
- Platform staff (`user.platform_role`) must have two-factor enabled; platform routes return 404 to everyone else.

## Testing

- `bun test` only (ADR 0012). Integration tests hit the real `casitrace_test` database and test bucket via `bun run test`; never point tests at the dev database.
- The audit log cannot be truncated, so tests assert on their own request/resource IDs, not table counts. Tests connect as `casitrace_app`, so audit reads need `withTenant`/`withPlatformAccess`.
- Auth tests use `apps/api/tests/auth-helpers.ts` (`verifiedUser`, `createOrg`, `addMember`, cookie-keeping `client`). Each client uses its own random IP so rate limits do not collide.
- Prisma returns lazy thenables: wrap in `Promise.resolve(...)` before `expect(...).rejects`.
- E2E tests live in `apps/web/e2e/*.e2e.ts` (not `.spec.ts`, which `bun test` would pick up).

## Environment notes

- Local S3 is SeaweedFS (MinIO images are no longer published). Buckets are created by the `s3-init` compose service; a write to a missing bucket can silently succeed, so storage health checks read back.
- Bun installs per-workspace `node_modules`; run package CLIs (`prisma`, `playwright`) from their package folder or via the root scripts.
- Bun loads `.env` from the current folder only; app scripts pass `--env-file=../../.env`.
- Better Auth disables its origin/CSRF checks when `NODE_ENV=test`; our config sets them on explicitly. Keep it that way.
