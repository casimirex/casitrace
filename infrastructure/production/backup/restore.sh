#!/bin/sh
# Prepares an EMPTY data directory for point-in-time recovery (docs/operations/runbooks/restore.md):
# fetches the newest base backup taken before the target, and configures WAL replay up to the target.
# The normal postgres service then starts, replays archived WAL, and promotes at the target.
#   restore.sh <target time, e.g. "2026-11-10 14:30:00+00" | latest>
set -eu
TARGET=${1:?usage: restore.sh <target time|latest>}
PGDATA=${PGDATA:-/var/lib/postgresql/data}
if [ -n "$(ls -A "$PGDATA" 2>/dev/null)" ]; then
  echo "refusing: $PGDATA is not empty (restore into a new, empty volume)" >&2
  exit 1
fi

if [ "$TARGET" = "latest" ]; then
  BACKUP=LATEST
else
  # Newest base backup that finished before the target (WAL replay needs a starting point before it).
  target_epoch=$(date -u -d "$TARGET" +%s)
  BACKUP=$(wal-g backup-list --json | tr '{' '\n' | sed -n 's/.*"backup_name":"\([^"]*\)".*"time":"\([^"]*\)".*/\1 \2/p' |
    while read -r name time; do
      t=$(date -u -d "$time" +%s)
      [ "$t" -lt "$target_epoch" ] && echo "$t $name"
    done | sort -n | tail -n 1 | cut -d' ' -f2)
  [ -n "$BACKUP" ] || { echo "no base backup older than $TARGET" >&2; exit 1; }
fi
echo "fetching base backup $BACKUP"
wal-g backup-fetch "$PGDATA" "$BACKUP"
touch "$PGDATA/recovery.signal"
{
  echo "restore_command = 'wal-g wal-fetch %f %p'"
  [ "$TARGET" != "latest" ] && echo "recovery_target_time = '$TARGET'"
  echo "recovery_target_action = 'promote'"
} >> "$PGDATA/postgresql.auto.conf"
chown -R postgres:postgres "$PGDATA"
chmod 700 "$PGDATA"
echo "restore prepared (backup $BACKUP, target $TARGET); start the postgres service to replay WAL"
