# Phase report — P9 Production hardening and pilot launch

- **Date:** 2026-11-10
- **Status:** Engineering part complete, pending review. The MVP exit gates that need real organisations and a production VM (6-week pilot, KPI report, go/no-go, production restore drill, availability) **cannot be met by building software** and are open. Everything needed to start them is in place and rehearsed end to end on a staging copy of the production stack.

## Exit gates (roadmap-v2 P9)

| Gate | Status | Evidence |
|---|---|---|
| All NFRs met or explicitly waived in an ADR | **Partly.** Met: trace latency, public page, durability (staging), isolation, audit, accessibility, i18n, dependency CVEs. Open: availability (needs a month of production uptime data), ASVS second review, real-device field test, legal review | `docs/architecture/non-functional-requirements.md` § Status at the end of P9 |
| Restore drill logged | **Pass on staging**, production drill open | `docs/operations/restore-drills/2026-11-10-staging.md`: database disk and one evidence object lost; PITR to a chosen time; counts and audit digest identical; change after the target absent; passport verifies; sign-in works; RTO 36 s; RPO ≤ 60 s |
| Pilot ran 6 weeks | **Not started** (needs design partners, country, hosting) | `docs/business/pilot-plan.md` with go-live checklist |
| KPI report written | **Not started**; KPI script ready and tested on dev data | `apps/api/scripts/pilot-kpis.ts` |
| Go/no-go decision recorded | **Not started**; template ready | `docs/adr/0016-mvp-go-no-go.md` |

## Required items

| Item | Done | Where |
|---|---|---|
| Threat model (STRIDE) for auth, public endpoints, uploads, signing key; fix every High | Yes: 3 High (spoofable client IP for rate limits, per-process rate limits, signing key in the environment) and 5 Medium fixed, each with a test | `docs/security/threat-model.md` |
| Backups with PITR + performed, recorded restore drill | Yes (staging) | WAL-G (continuous WAL every ≤ 60 s + daily encrypted base backup, off-site storage), `restore.sh`, `restore-drill.sh`, evidence mirror with SHA-256 checks |
| Observability: traces, metrics, error tracking, uptime checks, alert routing | Yes, except the external uptime monitor (a service outside the VM, chosen with the hosting provider) | OpenTelemetry → Tempo; Prometheus metrics (API, worker, queues, outbox, backups, WAL archiving); 10 alert rules with promtool tests; Alertmanager email routing tested end to end (worker stopped → on-call email after 148 s) |
| Load test against the §3 NFRs | Yes | `docs/operations/load-tests/2026-11-10-staging.json` |
| Signing key in a KMS with rotation; old versions still verify | Yes | OpenBao Transit, non-exportable key, AppRole least privilege; rotation rehearsed on staging with the API running |
| Legal minimum: terms, privacy policy, DPA, retention policy | Drafts (need counsel) | `docs/legal/`, `docs/compliance/data-retention.md` |
| Runbooks: deploy, rollback, restore, key rotation, incident response | Yes | `docs/operations/runbooks/` |
| Onboard pilot partners, run ≥ 6 weeks | No | Pilot plan |

## Built

**Deployment (ADR 0015, `infrastructure/production/`)**
- One Dockerfile with `app` (API and worker, non-root), `migrate` and `web` (Caddy + built SPA) targets; a Postgres image with WAL-G pinned by SHA-256.
- `compose.yml`: Caddy (only public service; TLS; public URL mapping; CSP/HSTS for the SPA; `/api/metrics` blocked), API, worker, one-shot migrations, Postgres with WAL archiving, backup service, evidence mirror, OpenBao (server mode, file storage, audit device), ClamAV, Prometheus, Alertmanager, Grafana LGTM.
- `staging.sh`: the same stack with local stand-ins for S3 and SMTP; generates secrets, bootstraps and unseals the KMS, renders monitoring config.

**KMS signing**
- `createTransitSigner`: signs through Transit, caches public keys of every key version, picks up rotations on the next signature (no restart), and verifies every KMS signature locally before it is stored. `Signer.sign` now returns the key ID actually used.
- Production config refuses a local key and a static KMS token; requires AppRole and a metrics token.
- `kms/bootstrap.sh` (Shamir 5/3, transit key, policies, AppRole, orphan key-operator token, root revoked), `kms/break-glass-token.sh`.

**Hardening**
- Client IP from the proxy-set header only (`platform/client-ip.ts`); shared Postgres rate-limit store with hashed keys.
- Strict CSP on public HTML (no scripts, stylesheet by hash), `Vary: Accept-Language`, public cache lifetime 30 s.
- Daily data-retention job (sessions, tokens, notifications, rate-limit rows).

**Observability**
- `@casitrace/observability`: tracing set-up (W3C context, OTLP/HTTP) and a small Prometheus registry. API server spans and RED metrics by route pattern; unhandled errors recorded on spans and counted; trace IDs in logs.
- Worker: job spans and metrics, outbox lag, queue depths, last backup, WAL archive health; `/health` for the container and uptime checks.

**Pilot instrumentation**
- Anonymous daily passport view counts, QR scans separate (resolver adds `?src=qr`); shown on the passport page (last 30 days).
- Capture forms report the time from first input to submit and the device type; stored in the event's audit entry.
- `pilot-kpis.ts`: all measurable KPIs from the data, audited as `platform.kpi_report`.

**Web:** `robots.txt`, meta description, `<main>` landmark on the sign-in pages (Lighthouse findings), view counts on the passport page.

## Problems found and fixed

1. **Public page capped at 5 requests/s (p95 4.8 s)** in the first load test, plus one 500 (database pool timeout). Causes: each view read, parsed (JSON + Zod) and verified the signed snapshot twice, and the renderer built a new `Intl.DisplayNames` for every origin area (500 on the test page). Fixed: one read per request, immutable versions parsed/verified once (cached by digest), formatters built once, identical origin lines shown once, API pool size configurable (default 20). Result: **119 requests/s, p95 194 ms** on the same 213 KB worst-case page, uncached (final run).
2. **Rate limits could be bypassed** by sending a fake `X-Forwarded-For` (T-1) and were per process (T-2). Verified through Caddy on staging: 30 requests with 30 different spoofed addresses were counted as one client.
3. **The signing key was an environment variable** (T-3). Moved to the KMS.
4. **Missing `Vary` on language-negotiated public pages** (T-5): a shared cache could serve the wrong language.
5. Found while rehearsing on staging: OpenBao 2.4 rejects `disable_mlock` and API-enabled audit devices; the bootstrap could not parse multi-line JSON; the key-operator token died with the revoked root token (now an orphan); the staging script leaked env values into compose; the first base backup ran before migrations so it was not recorded; `BackupMissing` paged during start-up (now a 30-minute grace period). Each was fixed and the run repeated.

## Test results (local)

| Suite | Result |
|---|---|
| Lint, typecheck, build | Pass |
| Backend + worker (`bun run test`) | 182 pass, 0 fail (22 files) |
| E2E (`bun run e2e`) | 12 passed, twice in a row |
| Alert rules (promtool) | 10 rules, 7 test groups pass |
| `bun audit` | 0 known vulnerabilities (379 packages) |
| Load test (staging, production build, over HTTP) | 5,000 lots seeded through `POST /events` in 56 s (write p95 116 ms). Trace p95: backward 709 ms, forward 724 ms, reaching 2,753 lots (target < 2 s). Public page, uncached, 20 concurrent visitors: 119 req/s, TTFB p95 194 ms (target < 500 ms), 2,000/2,000 OK |
| Lighthouse (mobile, simulated 4G) | Public page: performance 100, accessibility 100, best practices 100, SEO 91 → robots.txt added. Sign-in: 90 / 97 / 96 → `<main>` and meta description added |
| Restore drill (staging) | PASS, RTO 36 s |
| KMS rotation drill (staging) | PASS |

New tests: `kms-signer.test.ts` (5, real OpenBao), `hardening.test.ts` (7), `retention-observability.test.ts` (4), production config tests in `env.test.ts`, view counting in `publication.test.ts`.

## New dependencies

| Package | Why |
|---|---|
| `@opentelemetry/api` 1.9.1, `sdk-trace` / `core` / `resources` / `context-async-hooks` 2.12.0, `exporter-trace-otlp-http` 0.223.0 (in `@casitrace/observability`) | Roadmap requires OpenTelemetry traces. Stable 2.x line chosen over the 3-week-old 3.0 major. |
| Images: `openbao/openbao:2.4.1`, `prom/prometheus:v3.5.0`, `prom/alertmanager:v0.28.1`, `grafana/otel-lgtm:0.11.10`, `caddy:2.10.2-alpine`, `oven/bun:1.4.2-slim`; WAL-G v3.0.9 binary | KMS, metrics/alerts, traces/dashboards, TLS proxy, runtime, PITR backups |

No Prometheus client library: a 100-line registry covers counters, gauges and histograms.

## Known limitations

- **A sealed KMS blocks API start-up.** After a VM restart, three custodians must unseal before the site is back. Acceptable for a small pilot with business-hours support; auto-unseal needs a cloud KMS (ADR 0015 consequence). Verification keeps working while the API runs.
- Single VM: no redundancy (ADR 0015). Volumetric DoS would need a CDN/WAF (threat model, open).
- No Prisma/database spans in traces (HTTP and job spans only); no Sentry-style error grouping: errors are found through traces, logs and the `UnhandledErrors` alert.
- The parsed-passport cache means a row tampered with directly in the database (owner access, bypassing the append-only trigger) would still show "valid" for up to 10 minutes on an instance that had cached it.
- Off-boarding deletion of an organisation is a documented procedure, not built yet (needed only at the first off-boarding).
- Legal documents are drafts; retention periods marked *verify* need counsel.
- Image tags are not pinned by digest yet (release step in the threat model's open items).

## Decisions needed from you

1. Approve ADR 0015 (single VM, OpenBao, WAL-G, monitoring stack) or name a provider-managed alternative.
2. Pilot country (ADR 0002) → hosting provider and region, second public-page language.
3. Design partners for the pilot and a start date; custodians for the KMS unseal keys.
4. Counsel for terms / privacy policy / DPA / retention periods.
5. A second reviewer for the threat model and the ASVS checklist.
6. A GitHub remote so CI runs (it has never run there).
