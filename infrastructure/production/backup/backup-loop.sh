#!/bin/sh
# Daily base backup with WAL-G; WAL segments are archived continuously by Postgres (archive_command).
# Together they allow restoring to any point in time inside the retention window.
# Runs in the `backup` service (same image as postgres, data volume mounted read-only).
set -eu
: "${BACKUP_HOUR_UTC:=2}"
: "${BACKUP_RETAIN_FULL:=14}"
PGDATA=${PGDATA:-/var/lib/postgresql/data}

backup() {
  echo "$(date -u +%FT%TZ) base backup starting"
  wal-g backup-push "$PGDATA"
  wal-g delete retain FULL "$BACKUP_RETAIN_FULL" --confirm
  name=$(wal-g backup-list 2>/dev/null | tail -n 1 | awk '{print $1}')
  # Recorded for monitoring (alert BackupMissing).
  psql -v ON_ERROR_STOP=1 -q -c "INSERT INTO ops_backup_run (name) VALUES ('${name}')"
  wal-g backup-list --detail | tail -n 3
  echo "$(date -u +%FT%TZ) base backup done"
}

# --now: one backup immediately (drills, before risky changes), then exit.
if [ "${1:-}" = "--now" ]; then backup; exit 0; fi
# A first backup right away if none is recorded, so PITR works from day one.
if [ "$(psql -tAq -c 'SELECT count(*) FROM ops_backup_run')" = "0" ]; then backup; fi
[ "${1:-}" = "--once" ] && exit 0
last_day=""
while true; do
  now_hour=$(date -u +%H | sed 's/^0//')
  today=$(date -u +%F)
  if [ "${now_hour:-0}" -eq "$BACKUP_HOUR_UTC" ] && [ "$today" != "$last_day" ]; then
    backup || echo "$(date -u +%FT%TZ) BASE BACKUP FAILED" >&2
    last_day=$today
  fi
  sleep 300
done
