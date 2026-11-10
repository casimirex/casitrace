-- CreateTable
CREATE TABLE "evidence" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "current_file_version" INTEGER NOT NULL,
    "scheme" TEXT,
    "issuer_name" TEXT,
    "issuer_partner_id" UUID,
    "certificate_number" TEXT,
    "scope" TEXT,
    "valid_from" DATE,
    "valid_until" DATE,
    "expiry_notice_days" INTEGER,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_file" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "evidence_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "media_type" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "uploaded_by_id" UUID,
    "uploaded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scan_status" TEXT NOT NULL DEFAULT 'pending',
    "scan_detail" TEXT,
    "scanned_at" TIMESTAMPTZ(3),

    CONSTRAINT "evidence_file_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_link" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "evidence_id" UUID NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" UUID NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_status_change" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "evidence_id" UUID NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT NOT NULL,
    "reason" TEXT,
    "actor_type" TEXT NOT NULL,
    "actor_id" UUID,
    "file_version" INTEGER,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_status_change_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "org_id" UUID,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "dedupe_key" TEXT,
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "evidence_org_id_status_idx" ON "evidence"("org_id", "status");

-- CreateIndex
CREATE INDEX "evidence_org_id_type_idx" ON "evidence"("org_id", "type");

-- CreateIndex
CREATE INDEX "evidence_valid_until_idx" ON "evidence"("valid_until");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_file_storage_key_key" ON "evidence_file"("storage_key");

-- CreateIndex
CREATE INDEX "evidence_file_sha256_idx" ON "evidence_file"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_file_evidence_id_version_key" ON "evidence_file"("evidence_id", "version");

-- CreateIndex
CREATE INDEX "evidence_link_org_id_target_type_target_id_idx" ON "evidence_link"("org_id", "target_type", "target_id");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_link_evidence_id_target_type_target_id_key" ON "evidence_link"("evidence_id", "target_type", "target_id");

-- CreateIndex
CREATE INDEX "evidence_status_change_evidence_id_occurred_at_idx" ON "evidence_status_change"("evidence_id", "occurred_at");

-- CreateIndex
CREATE INDEX "notification_user_id_read_at_created_at_idx" ON "notification"("user_id", "read_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_user_id_dedupe_key_key" ON "notification"("user_id", "dedupe_key");

-- AddForeignKey
ALTER TABLE "evidence_file" ADD CONSTRAINT "evidence_file_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "evidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_link" ADD CONSTRAINT "evidence_link_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "evidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_status_change" ADD CONSTRAINT "evidence_status_change_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "evidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Row-level security (ADR 0008) ──────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['evidence','evidence_file','evidence_link','evidence_status_change']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO casitrace_app
         USING (org_id = casitrace_current_org() OR casitrace_platform_access())
         WITH CHECK (org_id = casitrace_current_org() OR casitrace_platform_access())',
      t || '_tenant', t);
  END LOOP;
END
$$;

-- ─── Append-only history (ADR 0007) ─────────────────────────────────────────
CREATE TRIGGER evidence_status_change_append_only BEFORE UPDATE OR DELETE ON "evidence_status_change"
  FOR EACH ROW EXECUTE FUNCTION casitrace_reject_mutation();
REVOKE UPDATE, DELETE, TRUNCATE ON "evidence_status_change" FROM casitrace_app;

-- Files: only the scan result may change after insert; files are never deleted.
CREATE OR REPLACE FUNCTION casitrace_evidence_file_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'evidence files cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.id, NEW.org_id, NEW.evidence_id, NEW.version, NEW.storage_key, NEW.sha256, NEW.size_bytes, NEW.media_type,
      NEW.original_name, NEW.uploaded_by_id, NEW.uploaded_at)
     IS DISTINCT FROM
     (OLD.id, OLD.org_id, OLD.evidence_id, OLD.version, OLD.storage_key, OLD.sha256, OLD.size_bytes, OLD.media_type,
      OLD.original_name, OLD.uploaded_by_id, OLD.uploaded_at) THEN
    RAISE EXCEPTION 'evidence_file is append-only: only scan results can change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER evidence_file_guard BEFORE UPDATE OR DELETE ON "evidence_file"
  FOR EACH ROW EXECUTE FUNCTION casitrace_evidence_file_guard();
REVOKE DELETE, TRUNCATE ON "evidence_file" FROM casitrace_app;

-- ─── Value constraints ──────────────────────────────────────────────────────
ALTER TABLE "evidence" ADD CONSTRAINT evidence_status_values
  CHECK (status IN ('submitted','checked','verified','rejected','expired','revoked'));
ALTER TABLE "evidence" ADD CONSTRAINT evidence_validity_order
  CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_from <= valid_until);
ALTER TABLE "evidence_file" ADD CONSTRAINT evidence_file_scan_values
  CHECK (scan_status IN ('pending','clean','infected','error'));
ALTER TABLE "evidence_file" ADD CONSTRAINT evidence_file_sha256_hex CHECK (sha256 ~ '^[0-9a-f]{64}$');
ALTER TABLE "evidence_link" ADD CONSTRAINT evidence_link_target_values
  CHECK (target_type IN ('organisation','location','partner','product','product_version','lot','event'));
