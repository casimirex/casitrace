# Phase report — P0 (engineering part) and P1 Foundation

- **Date:** 2026-11-10
- **Status:** P1 complete, pending review. P0 business items are open (owner).

## P0 — Discovery and decisions

| Exit gate | Status |
|---|---|
| ADRs D1–D13 recorded | Done: `docs/adr/0001`–`0013`. D3–D8, D10–D13 accepted; D9 (auth library) to confirm at P2 start. |
| NFR table | Done: `docs/architecture/non-functional-requirements.md` |
| Glossary | Done: `docs/domain/glossary.md` |
| Pilot commodity, jurisdiction (D1, D2) | **Open — owner.** Blocks P3, not P2. |
| ≥ 3 partner LOIs, walkthroughs | **Open — owner.** `docs/business/phase-0-open-items.md` |
| KDE/CTE matrix reviewed by a partner | **Open.** Template at `docs/business/kde-cte-matrix.md` |
| Regulatory facts verified | **Open.** `docs/compliance/regulatory-facts.md` (all rows unverified) |

## P1 — Engineering foundation

| Exit gate | Status | Evidence |
|---|---|---|
| Fresh setup → `bun install && docker compose up && bun run dev` works | Pass | API, worker and web start; `/api/ready` through the web proxy returns ok |
| `/health` and `/ready` (DB + storage) return OK | Pass | `apps/api/tests/system.test.ts`; manual curl |
| CI green on main | **Not run** — no git remote yet. Workflow at `.github/workflows/ci.yml`; every step was run locally and passes. |
| Outbox event round-trips to the worker | Pass | `apps/worker/tests/outbox-relay.test.ts` ("round trip") |
| Audit row written by a sample command | Pass | `apps/api/tests/command.test.ts` |

### Built

- Bun workspace: `apps/{api,worker,web}`, `packages/{db,contracts,shared,api-client}`.
- Postgres 17 + Prisma 7.10.1 (driver adapter `@prisma/adapter-pg`); first migration with `audit_log` and `outbox_event`; `audit_log` UPDATE/DELETE/TRUNCATE blocked by trigger.
- `runCommand`: one transaction for state change + mandatory audit entry + outbox events.
- Outbox relay (`FOR UPDATE SKIP LOCKED`) → pg-boss 12 queue `domain-events` with retries and a dead-letter queue → `EventRegistry` handlers.
- Hono API with contract-first routes (`@hono/zod-openapi`), OpenAPI 3.1 at `/openapi.json`, Swagger UI at `/docs`, request IDs, structured logs with redaction, standard error envelope, security headers, Zod-validated config.
- Private S3 storage port (Bun's built-in S3 client), presigned URLs capped at 15 minutes.
- Generated typed API client; React 19 + React Router 8 + TanStack Query + Tailwind 4 web shell with a live system-status page.
- Docker Compose: Postgres, SeaweedFS (S3), Mailpit. Biome lint/format. GitHub Actions CI.

### Test results (local)

| Suite | Result |
|---|---|
| `bun run lint` | 0 errors |
| `bun run typecheck` | 0 errors (7 packages) |
| `bun run test` | 18 pass, 0 fail (5 files) |
| `bun run build` | api, worker, web built |
| `bun run e2e` | 1 pass (status page shows API, database, storage ok) |

### Deviations from the roadmap

| Item | Change | Why |
|---|---|---|
| MinIO (D11) | SeaweedFS 3.97 locally | MinIO images are no longer published on Docker Hub or quay.io. Production can use any S3 service. ADR 0011 updated. |
| Testcontainers (D12) | Compose Postgres with a `casitrace_test` database | Simpler; identical locally and in CI. ADR 0012 amended. |
| TypeScript | 5.9.3, not 7.0 | 7.0 (native compiler) is recent; tooling compatibility unverified. Revisit later. |
| Package versions | Pinned to the newest stable release older than 2 weeks | Prisma's `latest` tag is an 8.0 release candidate; 7.10.1 is the stable line. |

### Audit notes (self-review) and known limitations

1. **The app connects as the database owner.** It could drop the append-only trigger. P2 must add a non-owner runtime role (also required for RLS, ADR 0008).
2. **Relay holds a transaction open while sending** up to 100 jobs to pg-boss. Fine at pilot scale; revisit if relay latency grows.
3. **`outbox_event` grows forever.** Add a retention job for published rows (P9).
4. **`/ready` writes a small probe object on every call.** Acceptable for health-check frequency; rate-limit public access in P2.
5. **No rate limiting, auth or CORS yet** — P2. The web app uses a same-origin `/api` proxy in development.
6. **Worker has no health endpoint**; container orchestration will need one (P9).
7. **Biome reformatted `roadmap.md` and `roadmap-v2.md`** (table padding, blank lines) during the first `biome check --write`, before Markdown was excluded. Text content is unchanged; only whitespace and table alignment differ.
8. **No git commits made.** The repository is initialised on `main` with everything unstaged.

## Next: P2 — Identity and access

Starts on approval. First step: confirm the auth library (ADR 0009) against Bun + Hono + Prisma 7, then the non-owner DB role and RLS.
