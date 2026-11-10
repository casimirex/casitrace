# Runbook: restore (database and evidence)

**Targets:** RPO ≤ 24 h (in practice ≤ 1 min: WAL archived every 60 s), RTO ≤ 4 h. **Last drill:** [restore-drills/](../restore-drills/) — run one at least every quarter and after any backup change.

Backups: WAL-G base backup daily (`backup` service) + continuous WAL archiving, encrypted (libsodium), off-site (`BACKUP_S3_*`), 14 daily fulls kept. Evidence objects: versioned bucket + daily mirror to the backup storage (`evidence-mirror` service running `scripts/ops/mirror-evidence.ts mirror`).

## A. Database: point-in-time restore

1. Declare the incident; note the time and **choose the target**: `latest` (disk/VM lost) or a time just before the damage (bad release, operator error). Write it down in UTC.
2. Stop writers: `docker compose stop web api worker backup`.
3. Keep the damaged data for analysis: `docker compose stop postgres` and rename the volume (`docker volume create pgdata_damaged_<date>`, copy, or just keep the old VM disk). Then remove the service volume: `docker compose rm -f postgres && docker volume rm casitrace-prod_pgdata`.
4. Prepare the restore into the new, empty volume:
   `docker compose run --rm --no-deps --entrypoint /usr/local/bin/restore.sh postgres "<target, e.g. 2026-11-10 14:30:00+00 | latest>"`
   It picks the newest base backup taken before the target and configures WAL replay.
5. `docker compose up -d --no-deps postgres`; wait until `docker compose exec postgres psql -U casitrace -tAc "select pg_is_in_recovery()"` returns `f` (replay finished, promoted on a new timeline; archiving continues).
6. Check: row counts look right; the latest audit entries are from just before the target; `select max(occurred_at) from audit_log`.
7. `docker compose up -d --wait api worker backup web`; smoke checks from [deploy.md](deploy.md).
8. Take a fresh base backup: `docker compose exec backup /usr/local/bin/backup-loop.sh --now`.
9. Tell affected organisations what was restored and which changes after the target they must re-enter (from their own records); write the incident note.

## B. Evidence objects

- Check integrity at any time: `VERIFY_TARGET=source bun scripts/ops/mirror-evidence.ts verify` (every stored file vs the SHA-256 recorded at upload).
- Restore missing or corrupt objects from the backup bucket: run `mirror` with `SOURCE_*` = backup bucket and `BACKUP_*` = evidence bucket. Only objects whose SHA-256 matches the database are copied.
- A whole bucket lost: create it, restore all objects the same way, then `verify`.

## Backup failed {#backup-failed}

Alerts `BackupMissing` / `WalArchiveFailing`:
1. `docker compose logs backup --tail 100` and `docker compose logs postgres | grep -i archive`.
2. Typical causes: backup storage credentials expired, bucket full or unreachable, encryption key missing. Fix, then `backup-loop.sh --now`.
3. While WAL archiving fails, WAL accumulates on the database disk: watch free space (`df -h`); if it gets below 15 %, escalate.
