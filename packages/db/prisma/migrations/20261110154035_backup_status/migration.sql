-- DropForeignKey
ALTER TABLE "passport_view_daily" DROP CONSTRAINT "passport_view_daily_passport_fkey";

-- CreateTable
CREATE TABLE "ops_backup_run" (
    "id" BIGSERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "finished_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ops_backup_run_pkey" PRIMARY KEY ("id")
);

-- Written only by the backup service (owner); the runtime role may read it for monitoring.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "ops_backup_run" FROM casitrace_app;
