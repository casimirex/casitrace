# Runbook: rollback

**When:** a release breaks production and a forward fix is not ready within 30 minutes.

1. Decide: if data may have been damaged (wrong writes), go to [restore.md](restore.md) instead (point in time before the release).
2. `export IMAGE_TAG=<previous tag>`; `git checkout <previous tag>` (for compose/config changes).
3. `docker compose up -d --wait api worker web`. Do **not** run `migrate` from the old tag: migrations are forward-only and expand-only within a release, so the old code runs on the new schema ([deploy.md](deploy.md#migration-rules-so-rollback-stays-possible)).
4. Smoke checks from [deploy.md](deploy.md) step 5.
5. If a migration itself is the problem (it cannot be rolled back): write a forward-fix migration; never edit an applied migration. If the schema change damaged data, restore to just before the release.
6. Write an incident note ([incident-response.md](incident-response.md)).
