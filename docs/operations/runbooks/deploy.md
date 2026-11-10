# Runbook: deploy

**When:** every release to production. **Who:** an operator with SSH access to the VM. **Time:** ~10 min.
Production layout and decisions: ADR 0015, `infrastructure/production/`.

## First installation (once)

1. VM in the EU region chosen in ADR 0002. Docker Engine + Compose plugin; swap **off or encrypted** (OpenBao does not lock memory); disk encryption on; SSH by key only; firewall: 80/443 in, nothing else.
2. `git clone` the repository to `/opt/casitrace` (read-only deploy key).
3. `cp infrastructure/production/.env.example infrastructure/production/.env`; fill every value from the secrets manager (see the comments in the file). `chmod 600 .env`.
4. Render monitoring config: `printf '%s' "$METRICS_TOKEN" > infrastructure/production/monitoring/metrics-token` and `envsubst < monitoring/alertmanager.yml.tmpl > monitoring/alertmanager.yml` (with `.env` exported).
5. `cd infrastructure/production && docker compose build && docker compose up -d openbao`.
6. KMS bootstrap — [key-rotation.md § Bootstrap](key-rotation.md#bootstrap). Put `KMS_ROLE_ID` / `KMS_SECRET_ID` into `.env`.
7. `docker compose up -d --wait` (migrations run first as a one-shot service; the API starts only after they succeed and the KMS is unsealed).
8. Point DNS at the VM; Caddy obtains the TLS certificate for `SITE_ADDRESS`.
9. External uptime monitor (outside the VM): `GET https://<site>/api/ready` and one public passport page, every minute, alerting the on-call address.
10. Run the smoke checks below, then a restore drill ([restore.md](restore.md)) before onboarding the first organisation.

## Release

1. CI green on the commit (lint, typecheck, unit/integration, isolation suite, E2E, `bun audit`, alert rule tests).
2. On the VM: `git fetch && git checkout <tag>`; `export IMAGE_TAG=<tag>`.
3. Back up first: `docker compose exec backup /usr/local/bin/backup-loop.sh --now`.
4. `docker compose build && docker compose up -d --wait`. The `migrate` service applies new migrations; API and worker restart on the new image.
5. Smoke checks (2 min):
   - `curl -s https://<site>/api/ready` → `"status":"ok"`.
   - Open a published passport page; `node scripts/verify-passport.mjs https://<site>/api/v1/public/passports/<id> https://<site>/api/v1/public/keys` → `valid: true`.
   - Sign in; open an organisation's lots page.
   - Prometheus (`ssh -L 9090:localhost:9090`) → Status → Targets: api and worker **up**; no new alerts.
6. Record the release (tag, time, operator) in the change log.

## Migration rules (so rollback stays possible)

Migrations are forward-only (Prisma). Write them **expand → contract**: a release only adds columns/tables or relaxes constraints; removing or renaming happens in a later release once no running code uses the old shape. Then the previous image still works against the new schema, and rollback is an image switch (see [rollback.md](rollback.md)).
