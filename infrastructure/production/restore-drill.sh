#!/usr/bin/env bash
# Restore drill (P9 gate: "restore drill performed and recorded"; NFR RPO ≤ 24 h, RTO ≤ 4 h).
# Runs against the staging rehearsal (staging.sh up). Simulates losing the database disk and an
# evidence object, restores both from the off-site backups, verifies the data, and writes a log to
# docs/operations/restore-drills/. The production drill follows docs/operations/runbooks/restore.md
# by hand with the same checks.
set -euo pipefail
cd "$(dirname "$0")"
ROOT=$(cd ../.. && pwd)
ENV_FILE=.env.staging
DC=(docker compose -p casitrace-staging -f compose.yml -f compose.staging.yml --env-file "$ENV_FILE")
NET=casitrace-staging_internal
BUN=(docker run --rm --network "$NET" -v "$ROOT/scripts:/scripts:ro" oven/bun:1.4.2-slim bun)
sql() { "${DC[@]}" exec -T postgres psql -U casitrace -d casitrace -tAq -c "$1"; }
now() { date -u +%s; }
iso() { date -u +%FT%TZ; }
LOG=()
step() { LOG+=("| $(iso) | $1 |"); echo "== $1"; }
set -a; . "./$ENV_FILE"; set +a
S3ENV=(-e OWNER_DATABASE_URL="postgresql://casitrace:${DB_OWNER_PASSWORD}@postgres:5432/casitrace"
  -e SOURCE_ENDPOINT=http://s3:8333 -e SOURCE_REGION=us-east-1 -e SOURCE_BUCKET=casitrace-evidence
  -e SOURCE_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" -e SOURCE_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY"
  -e BACKUP_ENDPOINT=http://s3:8333 -e BACKUP_REGION=us-east-1 -e BACKUP_BUCKET=casitrace-evidence-backup
  -e BACKUP_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" -e BACKUP_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY")
mirror() { docker run --rm --network "$NET" "${S3ENV[@]}" "$@" -v "$ROOT/scripts:/scripts:ro" oven/bun:1.4.2-slim bun /scripts/ops/mirror-evidence.ts "${MODE}"; }

step "Seed: account, harvest lot, scanned evidence file, published passport"
SEED=$("${BUN[@]}" /scripts/ops/drill-seed.ts http://api:3000 http://mailpit:8025 "$WEB_ORIGIN")
PUBLIC_ID=$(echo "$SEED" | sed -n 's/.*"publicId":"\([^"]*\)".*/\1/p')
echo "$SEED"

step "Evidence objects mirrored to the backup bucket"
MODE=mirror mirror | tee /tmp/drill-mirror.json

step "Fresh base backup (the daily job), then data recorded before the restore target"
"${DC[@]}" exec -T backup /usr/local/bin/backup-loop.sh --now
sql "INSERT INTO ops_backup_run (name) VALUES ('drill-marker-before-target')"
sleep 2
TARGET=$(sql "SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.MS') || '+00'")
COUNTS_SQL="SELECT json_build_object('lots',(SELECT count(*) FROM lot),'events',(SELECT count(*) FROM trace_event),'audit',(SELECT count(*) FROM audit_log),'passportVersions',(SELECT count(*) FROM passport_version),'evidenceFiles',(SELECT count(*) FROM evidence_file),'users',(SELECT count(*) FROM \"user\"),'auditDigest',(SELECT md5(string_agg(id::text, ',' ORDER BY id)) FROM audit_log))"
BEFORE=$(sql "$COUNTS_SQL")
sleep 2
step "Restore target recorded: $TARGET; then a change AFTER the target that the restore must not contain"
sql "INSERT INTO ops_backup_run (name) VALUES ('drill-marker-after-target')"
sql "SELECT pg_switch_wal()" >/dev/null
for _ in $(seq 1 60); do
  [ "$(sql "SELECT last_archived_wal >= pg_walfile_name(pg_current_wal_lsn() - 1) FROM pg_stat_archiver")" = "t" ] && break
  sleep 1
done
LAST_ARCHIVED=$(sql "SELECT last_archived_time FROM pg_stat_archiver")

step "DISASTER: database disk lost (postgres, api, worker, backup stopped; data volume deleted); one evidence object deleted"
T_DISASTER=$(now)
KEY=$(sql "SELECT storage_key FROM evidence_file ORDER BY uploaded_at DESC LIMIT 1")
docker run --rm --network "$NET" -e K="$KEY" -e AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" -e AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY" \
  oven/bun:1.4.2-slim bun -e 'import { S3Client } from "bun"; await new S3Client({ endpoint: "http://s3:8333", region: "us-east-1", bucket: "casitrace-evidence" }).delete(process.env.K)'
"${DC[@]}" stop api worker backup postgres
"${DC[@]}" rm -f postgres backup >/dev/null
docker volume rm casitrace-staging_pgdata >/dev/null

step "Restore: newest base backup before the target + WAL replay to $TARGET, into a new volume"
T_RESTORE=$(now)
"${DC[@]}" run --rm --no-deps --entrypoint /usr/local/bin/restore.sh postgres "$TARGET"
"${DC[@]}" up -d --no-deps postgres
for _ in $(seq 1 300); do
  [ "$(sql "SELECT NOT pg_is_in_recovery()" 2>/dev/null || true)" = "t" ] && break
  sleep 1
done
T_DB_READY=$(now)
AFTER=$(sql "$COUNTS_SQL")
MARK_BEFORE=$(sql "SELECT count(*) FROM ops_backup_run WHERE name = 'drill-marker-before-target'")
MARK_AFTER=$(sql "SELECT count(*) FROM ops_backup_run WHERE name = 'drill-marker-after-target'")

step "Evidence objects restored from the backup bucket and checked against the database SHA-256"
docker run --rm --network "$NET" "${S3ENV[@]}" -e SOURCE_BUCKET=casitrace-evidence-backup -e BACKUP_BUCKET=casitrace-evidence \
  -v "$ROOT/scripts:/scripts:ro" oven/bun:1.4.2-slim bun /scripts/ops/mirror-evidence.ts mirror | tee /tmp/drill-restore-objects.json
docker run --rm --network "$NET" "${S3ENV[@]}" -e VERIFY_TARGET=source \
  -v "$ROOT/scripts:/scripts:ro" oven/bun:1.4.2-slim bun /scripts/ops/mirror-evidence.ts verify | tee /tmp/drill-verify.json

step "Application restarted (API, worker, backups)"
"${DC[@]}" up -d --wait api worker backup web >/dev/null
T_APP_READY=$(now)

step "Checks through the public entry point"
READY=$(curl -s "http://localhost:${PUBLIC_PORT:-8080}/api/ready")
PAGE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${PUBLIC_PORT:-8080}/p/$PUBLIC_ID")
VERIFY=$(node "$ROOT/scripts/verify-passport.mjs" "http://localhost:${PUBLIC_PORT:-8080}/api/v1/public/passports/$PUBLIC_ID" "http://localhost:${PUBLIC_PORT:-8080}/api/v1/public/keys" | tr -d '\n ' || true)
SIGNIN=$(curl -s -o /dev/null -w "%{http_code}" -H "origin: $WEB_ORIGIN" -H "content-type: application/json" \
  -d "{\"email\":\"$(echo "$SEED" | sed -n 's/.*"email":"\([^"]*\)".*/\1/p')\",\"password\":\"drill-Password-1\"}" "http://localhost:${PUBLIC_PORT:-8080}/api/v1/auth/sign-in/email")
OBJ_OK=$(sed -n 's/.*"corrupt": \[\].*/ok/p' /tmp/drill-verify.json | head -1)
MISSING=$(tr -d '\n ' < /tmp/drill-verify.json | sed -n 's/.*"missing":\[\([^]]*\)\].*/\1/p')

RTO=$((T_APP_READY - T_DISASTER))
PASS=yes
[ "$BEFORE" = "$AFTER" ] || PASS=no
[ "$MARK_BEFORE" = "1" ] && [ "$MARK_AFTER" = "0" ] || PASS=no
echo "$READY" | grep -q '"status":"ok"' || PASS=no
[ "$PAGE" = "200" ] || PASS=no
echo "$VERIFY" | grep -q '"valid":true' || PASS=no
[ "$SIGNIN" = "200" ] || PASS=no
[ -z "$MISSING" ] || PASS=no
[ "$RTO" -lt 14400 ] || PASS=no

OUT="$ROOT/docs/operations/restore-drills/$(date -u +%F)-staging.md"
mkdir -p "$(dirname "$OUT")"
{
  echo "# Restore drill — $(date -u +%F) (staging rehearsal)"
  echo
  echo "- **Result:** $([ "$PASS" = yes ] && echo PASS || echo FAIL)"
  echo "- **Environment:** staging rehearsal of the production stack (\`infrastructure/production\`, production images and configuration; local S3 and SMTP stand-ins). Run by \`restore-drill.sh\`."
  echo "- **Scenario:** the database disk is lost and one evidence object is deleted. Restore to a point in time chosen before a known later change."
  echo "- **RTO (disaster → application serving):** ${RTO} s (target ≤ 4 h). Database restore and WAL replay alone: $((T_DB_READY - T_RESTORE)) s."
  echo "- **RPO:** WAL is archived at least every 60 s (\`archive_timeout\`); the last segment before the disaster was archived at ${LAST_ARCHIVED}. Restoring to \`latest\` loses at most the unarchived last minute (target ≤ 24 h). This drill restored to an earlier, chosen point to prove point-in-time recovery."
  echo
  echo "## Timeline (UTC)"
  echo
  echo "| Time | Step |"
  echo "|---|---|"
  printf '%s\n' "${LOG[@]}"
  echo
  echo "## Checks"
  echo
  echo "| Check | Expected | Result |"
  echo "|---|---|---|"
  echo "| Row counts and audit-log digest at the target | identical before and after | before \`$BEFORE\` · after \`$AFTER\` |"
  echo "| Change before the target is present | 1 | $MARK_BEFORE |"
  echo "| Change after the target is absent (point in time) | 0 | $MARK_AFTER |"
  echo "| \`/api/ready\` through Caddy | ok | \`$READY\` |"
  echo "| Public page of the passport published before the disaster | 200 | $PAGE |"
  echo "| Independent signature check (\`scripts/verify-passport.mjs\`, KMS-signed) | valid | \`$(echo "$VERIFY" | cut -c1-200)\` |"
  echo "| Sign-in with an account created before the target | 200 | $SIGNIN |"
  echo "| Evidence objects present and matching the SHA-256 in the database | none missing or corrupt | \`$(tr -d '\n ' < /tmp/drill-verify.json)\` |"
  echo
  echo "## Notes"
  echo
  echo "- Backups are encrypted with libsodium before upload; the restore used the key from the secrets store (\`BACKUP_ENCRYPTION_KEY\`)."
  echo "- After the restore, Postgres runs on a new timeline and keeps archiving; the backup service took over again."
  echo "- The production drill must be repeated on the production VM after go-live (runbook), with a person timing it."
} > "$OUT"
echo "drill result: $PASS — log: $OUT"
[ "$PASS" = yes ]
