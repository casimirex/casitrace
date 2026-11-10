# ADR 0015: Pilot deployment, key management and observability (P9)

- **Status:** Proposed (needs product owner approval: hosting provider and region follow ADR 0002)
- **Date:** 2026-11-10
- **Roadmap ref:** roadmap-v2.md P9; amends ADR 0013 (signing key in a KMS)

## Context

P9 needs a production environment for a 6-week pilot with a handful of organisations: backups with
point-in-time recovery (RPO ≤ 24 h, RTO ≤ 4 h), the passport signing key in a KMS, traces, metrics,
alerting, and runbooks. The pilot country and hosting provider are not chosen yet (ADR 0002), so the
set-up must not depend on one cloud's managed services. The pilot load is small (NFR §3 sizes).

## Decision

1. **One EU virtual machine running Docker Compose** (`infrastructure/production/compose.yml`).
   Only Caddy (TLS, reverse proxy, public URL mapping) is reachable from the internet; API, worker,
   database, KMS and monitoring sit on an internal network. Images are built from one Dockerfile
   (`app`, `migrate`, `web` targets) and tagged per release. Migrations run as a one-shot service
   before the API and worker start.
2. **Postgres 17 with WAL-G**: continuous WAL archiving (`archive_timeout = 60 s`) plus a daily base
   backup, encrypted client-side (libsodium) and stored in **off-site object storage at a different
   provider or region**, 14 daily fulls retained. Restores are point-in-time into a fresh volume.
   Evidence objects live in managed S3-compatible storage with versioning, mirrored daily to the
   backup storage (`scripts/ops/mirror-evidence.ts`), and are checked against the SHA-256 in the
   database.
3. **KMS: OpenBao Transit** (open-source, Vault-API compatible) on the same VM, server mode, file
   storage, Shamir unseal (5 shares, threshold 3, separate custodians). The Ed25519 key is created
   non-exportable; the API authenticates with AppRole and its policy can only sign and read public
   keys. Rotation is an operator action (`transit/keys/…/rotate`); all key versions stay published
   for verification, and keys from the local-key era are carried in `PASSPORT_PREVIOUS_KEYS`.
   Production refuses a local key (`PASSPORT_SIGNER=kms` is required). A managed KMS (any provider
   offering Vault Transit, e.g. HCP Vault) can replace it by changing `KMS_ADDR` and credentials.
4. **Observability**: OpenTelemetry traces (OTLP/HTTP) from API and worker; Prometheus metrics
   (`/api/metrics`, worker `:9464/metrics`, token-protected, never routed by Caddy); Prometheus alert
   rules with promtool unit tests; Alertmanager routes pages and tickets by email; Grafana LGTM for
   traces and dashboards. Error tracking = unhandled errors recorded on spans and counted
   (`casitrace_unhandled_errors_total`, alert), found by request ID. An **external uptime monitor**
   (outside the VM, EU provider) checks `/api/ready` and a public page every minute.
5. **Rate limits are shared** through Postgres (`rate_limit_bucket`, hashed keys), so the API can run
   more than one instance; the client address is the single X-Forwarded-For value set by Caddy.

## Consequences

- A single VM is a single point of failure. 99.5 % monthly allows ~3.6 h downtime; the restore drill
  (RTO measured) and a documented rebuild cover it for the pilot. Revisit (managed Postgres, two
  instances) when pilot evidence justifies it.
- OpenBao on the same VM means a VM compromise exposes the ability to sign (not the key itself). The
  audit device logs every signing request; signatures by an attacker would be visible and the key
  version can be rotated and the affected versions listed. A separate KMS host is the upgrade path.
- Unseal keys must be handled by people: a restart of the VM needs a quorum to unseal before the API
  can start (runbook). Auto-unseal requires a cloud KMS and is deferred.
- The hosting provider and region remain open (ADR 0002); nothing in the set-up depends on them.
