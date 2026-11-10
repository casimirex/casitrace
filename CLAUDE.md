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
| Run API + worker + web | `bun run dev` (web on :5173, API on :3000, API docs at :3000/docs) |
| New migration | `bun run db:migrate -- --name <name>` then `bun run db:generate` |
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
2. **Append-only tables** (audit log now; events from P5) reject UPDATE/DELETE by trigger. Fix mistakes with correction events, never by editing rows. New append-only tables reuse `casitrace_reject_mutation()`.
3. **Tenant isolation** (ADR 0008, from P2): every tenant-owned table has `org_id`; every query is org-scoped; RLS backs it up; every new route gets an isolation test.
4. **Domain code is framework-free**: no Prisma, Hono, S3 or AI SDK imports in `domain/`. Use ports (see `ObjectStorage`).
5. **Validate every input** with Zod via `@hono/zod-openapi` routes. Responses are explicit DTOs; never return Prisma models directly.
6. **Errors**: throw `AppError` with a code; the HTTP layer maps it to the standard envelope. Never leak internal error text in responses.
7. **IDs** are UUIDv7 from `newId()`. **Quantities** are `Decimal`, never float. **Timestamps** are `timestamptz`, UTC.
8. **Migrations** via `prisma migrate` only; never `db push`. Never edit an applied migration.
9. **Evidence storage is private**. Access only through presigned URLs of at most 15 minutes.
10. **Outbox consumers are idempotent** on `eventId` (delivery is at-least-once).
11. No mock data or fake integrations in production paths. No new dependency without a reason in the phase report.
12. TypeScript strict; no `any`; no non-null assertions without a comment.

## Testing

- `bun test` only (ADR 0012). Integration tests hit the real `casitrace_test` database and test bucket via `bun run test`; never point tests at the dev database.
- The audit log cannot be truncated, so tests assert on their own request/resource IDs, not table counts.
- Prisma returns lazy thenables: wrap in `Promise.resolve(...)` before `expect(...).rejects`.
- E2E tests live in `apps/web/e2e/*.e2e.ts` (not `.spec.ts`, which `bun test` would pick up).

## Environment notes

- Local S3 is SeaweedFS (MinIO images are no longer published). Buckets are created by the `s3-init` compose service; a write to a missing bucket can silently succeed, so storage health checks read back.
- Bun installs per-workspace `node_modules`; run package CLIs (`prisma`, `playwright`) from their package folder or via the root scripts.
- Bun loads `.env` from the current folder only; app scripts pass `--env-file=../../.env`.
