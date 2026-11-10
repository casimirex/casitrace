-- CreateTable
CREATE TABLE "organization_profile" (
    "org_id" UUID NOT NULL,
    "legal_name" TEXT NOT NULL,
    "registration_number" TEXT,
    "vat_number" TEXT,
    "country_code" CHAR(2) NOT NULL,
    "address_line1" TEXT,
    "address_line2" TEXT,
    "city" TEXT,
    "postal_code" TEXT,
    "region" TEXT,
    "business_roles" TEXT[],
    "website" TEXT,
    "description" TEXT,
    "verification_status" TEXT NOT NULL DEFAULT 'unverified',
    "verification_note" TEXT,
    "verification_requested_at" TIMESTAMPTZ(3),
    "verified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organization_profile_pkey" PRIMARY KEY ("org_id")
);

-- CreateTable
CREATE TABLE "location" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "parent_id" UUID,
    "gln" TEXT,
    "country_code" CHAR(2),
    "address_line1" TEXT,
    "city" TEXT,
    "postal_code" TEXT,
    "region" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "boundary" JSONB,
    "area_ha" DECIMAL(14,4),
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trading_partner" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "linked_org_id" UUID,
    "email" TEXT,
    "country_code" CHAR(2),
    "registration_number" TEXT,
    "gln" TEXT,
    "address_line1" TEXT,
    "city" TEXT,
    "postal_code" TEXT,
    "notes" TEXT,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "trading_partner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uom" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "to_base" DECIMAL(24,12) NOT NULL,

    CONSTRAINT "uom_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "product" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "gtin" TEXT,
    "current_version" INTEGER NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_version" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "uom_code" TEXT NOT NULL,
    "description" TEXT,
    "gtin" TEXT,
    "origin_country" CHAR(2),
    "origin_region" TEXT,
    "allergens" TEXT[],
    "storage_conditions" TEXT,
    "shelf_life_days" INTEGER,
    "attributes" JSONB NOT NULL,
    "attributes_schema" TEXT NOT NULL,
    "change_note" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_component" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "product_version_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "component_product_id" UUID,
    "name" TEXT NOT NULL,
    "percentage" DECIMAL(7,4),

    CONSTRAINT "product_component_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_unit_conversion" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "product_version_id" UUID NOT NULL,
    "from_uom" TEXT NOT NULL,
    "to_uom" TEXT NOT NULL,
    "factor" DECIMAL(24,12) NOT NULL,

    CONSTRAINT "product_unit_conversion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "organization_profile_verification_status_idx" ON "organization_profile"("verification_status");

-- CreateIndex
CREATE INDEX "location_org_id_type_idx" ON "location"("org_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "location_org_id_code_key" ON "location"("org_id", "code");

-- CreateIndex
CREATE INDEX "trading_partner_org_id_name_idx" ON "trading_partner"("org_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "trading_partner_org_id_linked_org_id_key" ON "trading_partner"("org_id", "linked_org_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_org_id_sku_key" ON "product"("org_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "product_org_id_gtin_key" ON "product"("org_id", "gtin");

-- CreateIndex
CREATE INDEX "product_version_org_id_category_idx" ON "product_version"("org_id", "category");

-- CreateIndex
CREATE UNIQUE INDEX "product_version_product_id_version_key" ON "product_version"("product_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "product_component_product_version_id_ordinal_key" ON "product_component"("product_version_id", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "product_unit_conversion_product_version_id_from_uom_to_uom_key" ON "product_unit_conversion"("product_version_id", "from_uom", "to_uom");

-- AddForeignKey
ALTER TABLE "organization_profile" ADD CONSTRAINT "organization_profile_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location" ADD CONSTRAINT "location_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_version" ADD CONSTRAINT "product_version_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_version" ADD CONSTRAINT "product_version_uom_code_fkey" FOREIGN KEY ("uom_code") REFERENCES "uom"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_component" ADD CONSTRAINT "product_component_product_version_id_fkey" FOREIGN KEY ("product_version_id") REFERENCES "product_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_unit_conversion" ADD CONSTRAINT "product_unit_conversion_product_version_id_fkey" FOREIGN KEY ("product_version_id") REFERENCES "product_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Row-level security for tenant-owned master data (ADR 0008) ─────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['organization_profile','location','trading_partner','product','product_version',
                           'product_component','product_unit_conversion']
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

-- ─── Product versions are immutable (ADR 0007) ──────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['product_version','product_component','product_unit_conversion']
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I
                    FOR EACH ROW EXECUTE FUNCTION casitrace_reject_mutation()', t || '_append_only', t);
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %I FROM casitrace_app', t);
  END LOOP;
END
$$;

-- ─── Units of measure: global reference data, read-only for the app ─────────
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "uom" FROM casitrace_app;
INSERT INTO "uom" ("code", "name", "dimension", "to_base") VALUES
  ('kg',   'kilogram',   'mass',   1),
  ('g',    'gram',       'mass',   0.001),
  ('t',    'tonne',      'mass',   1000),
  ('l',    'litre',      'volume', 1),
  ('ml',   'millilitre', 'volume', 0.001),
  ('unit', 'unit',       'count',  1);

-- Basic shape checks the application also enforces.
ALTER TABLE "location" ADD CONSTRAINT location_lat_range CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90);
ALTER TABLE "location" ADD CONSTRAINT location_lng_range CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180);
ALTER TABLE "product_unit_conversion" ADD CONSTRAINT conversion_positive CHECK (factor > 0);
ALTER TABLE "product_component" ADD CONSTRAINT component_percentage CHECK (percentage IS NULL OR (percentage > 0 AND percentage <= 100));
