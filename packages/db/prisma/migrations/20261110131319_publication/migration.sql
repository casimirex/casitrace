-- AlterTable
ALTER TABLE "organization_profile" ADD COLUMN     "public_listing" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "passport" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "public_id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "product_id" UUID NOT NULL,
    "lot_id" UUID,
    "template" TEXT NOT NULL,
    "disclosure" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "current_version" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "passport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "passport_version" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "passport_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "canonical" TEXT NOT NULL,
    "digest" CHAR(64) NOT NULL,
    "signature" TEXT NOT NULL,
    "key_id" TEXT NOT NULL,
    "gtin" TEXT,
    "lot_code" TEXT,
    "published_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_by_id" UUID,

    CONSTRAINT "passport_version_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "passport_public_id_key" ON "passport"("public_id");

-- CreateIndex
CREATE INDEX "passport_org_id_status_idx" ON "passport"("org_id", "status");

-- CreateIndex
CREATE INDEX "passport_lot_id_idx" ON "passport"("lot_id");

-- CreateIndex
CREATE INDEX "passport_product_id_idx" ON "passport"("product_id");

-- CreateIndex
CREATE INDEX "passport_version_gtin_lot_code_idx" ON "passport_version"("gtin", "lot_code");

-- CreateIndex
CREATE UNIQUE INDEX "passport_version_passport_id_version_key" ON "passport_version"("passport_id", "version");

-- AddForeignKey
ALTER TABLE "passport_version" ADD CONSTRAINT "passport_version_passport_id_fkey" FOREIGN KEY ("passport_id") REFERENCES "passport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── RLS (ADR 0008). Public reads go through the narrow public_passport view below. ──
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['passport','passport_version']
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

CREATE TRIGGER passport_version_append_only BEFORE UPDATE OR DELETE ON "passport_version"
  FOR EACH ROW EXECUTE FUNCTION casitrace_reject_mutation();
REVOKE UPDATE, DELETE, TRUNCATE ON "passport_version" FROM casitrace_app;
REVOKE DELETE, TRUNCATE ON "passport" FROM casitrace_app;

ALTER TABLE "passport" ADD CONSTRAINT passport_scope CHECK ((scope = 'lot') = (lot_id IS NOT NULL) AND scope IN ('product','lot'));
ALTER TABLE "passport" ADD CONSTRAINT passport_status CHECK (status IN ('draft','published','withdrawn'));

-- What anyone on the internet may read: published versions of published passports, nothing else.
-- Runs with the owner's rights (bypasses RLS) and exposes only the signed public snapshot.
CREATE VIEW "public_passport_version" AS
  SELECT p.public_id, p.status, p.current_version, p.org_id, v.version, v.canonical, v.digest, v.signature, v.key_id,
         v.gtin, v.lot_code, v.published_at, p.lot_id
  FROM "passport" p JOIN "passport_version" v ON v.passport_id = p.id
  WHERE p.status IN ('published', 'withdrawn');
REVOKE ALL ON "public_passport_version" FROM PUBLIC;
GRANT SELECT ON "public_passport_version" TO casitrace_app;

-- Public directory: only organisations that opted in, and only directory fields.
CREATE VIEW "public_directory" AS
  SELECT o.id, o.name, o.slug, p.city, p.region, p.country_code, p.business_roles, p.website, p.description,
         (p.verification_status = 'verified') AS verified
  FROM "organization" o JOIN "organization_profile" p ON p.org_id = o.id
  WHERE p.public_listing;
REVOKE ALL ON "public_directory" FROM PUBLIC;
GRANT SELECT ON "public_directory" TO casitrace_app;
