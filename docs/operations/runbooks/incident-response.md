# Runbook: incident response

**On-call:** the address in `ALERT_ONCALL_EMAIL` receives `page` alerts immediately (repeat hourly); `ticket` alerts go to `ALERT_TICKETS_EMAIL`. During the pilot, on-call is business hours CET plus best effort; organisations are told this in the pilot agreement.

## Severity

| Sev | Meaning | Examples | Response |
|---|---|---|---|
| 1 | Data exposure across organisations, signing key compromise, data loss | isolation failure, forged passports | Immediately; inform affected organisations within 24 h; GDPR breach assessment (72 h to the supervisory authority if personal data is at risk) |
| 2 | Service down or a recall cannot be run | API down, worker down during a recall | Within 1 h in business hours |
| 3 | Degraded | slow pages, failing jobs, backups failing | Same or next business day |

## First steps for every incident

1. Acknowledge the alert; open an incident note (time, symptom, who is handling it).
2. Find the scope: Grafana (`ssh -L 3001:localhost:3001`) → traces for the failing route; logs with `docker compose logs <service> --since 30m`; every log line and error response carries a `requestId` and log lines a `traceId`.
3. Stabilise first (rollback, restart, block), investigate second.
4. Afterwards: a short written review — timeline, cause, what changes. Severity 1–2 always.

## API down {#api-down}

`docker compose ps`; `docker compose logs api --tail 100`.
- Exits at start with "Invalid configuration": a missing or wrong secret in `.env`.
- KMS sealed: [key-rotation.md § Unseal](key-rotation.md#unseal-after-a-restart).
- Database unreachable: `docker compose logs postgres`; disk full? (`df -h`).
- After a release: [rollback.md](rollback.md).

## Worker down / outbox backlog {#worker-down}

While the worker is down, emails, evidence scans and recall notices queue up (nothing is lost: the outbox keeps them).
`docker compose logs worker --tail 100`; `docker compose restart worker`. If a recall is running, tell the recalling organisation that customer emails are delayed and use the exported contact list in the meantime.

## Errors / unhandled errors {#errors}

`HighErrorRate` or `UnhandledErrors`: in Grafana → Tempo, search `status=error` for the service; the span holds the exception. Correlate with logs by `requestId`. If it started with a release: rollback.

## Jobs failing {#jobs-failing}

`casitrace_worker_jobs_total{outcome="error"}` by `type`. Email: SMTP credentials or provider outage. Evidence scan: ClamAV (`docker compose logs clamav`; signatures update needs outbound network). pg-boss retries failed jobs; failed jobs stay visible in `casitrace_queue_jobs{state="failed"}`.

## Slow {#slow}

`PublicPageSlow` / `TraceSlow`: check host CPU/memory (`docker stats`), database (`pg_stat_activity` for long queries), and whether traffic spiked (`casitrace_http_requests_total` rate). Public pages can be cached by a CDN for 30 s (`Cache-Control`).

## Suspected cross-tenant exposure or breach (Sev 1)

1. Preserve evidence: do not restart or restore yet; snapshot the VM disk.
2. Contain: if an endpoint is the cause, block it in Caddy (`respond /path 404`) and deploy.
3. Use the audit log and `shared_access` log to list what was read, by whom and when.
4. Inform affected organisations (as processor, without undue delay — DPA §8) and support their GDPR notification.
