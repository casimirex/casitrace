-- AlterTable
ALTER TABLE "trading_partner" ADD COLUMN     "approval_status" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN     "approved_at" TIMESTAMPTZ(3),
ADD COLUMN     "approved_by_id" UUID;

-- CreateTable
CREATE TABLE "handoff" (
    "id" UUID NOT NULL,
    "sender_org_id" UUID NOT NULL,
    "receiver_org_id" UUID NOT NULL,
    "ship_event_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "lines" JSONB NOT NULL,
    "shipped_at" TIMESTAMPTZ(3) NOT NULL,
    "dispute_reason" TEXT,
    "receive_event_id" UUID,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "handoff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cross_lot_link" (
    "id" UUID NOT NULL,
    "upstream_org_id" UUID NOT NULL,
    "upstream_lot_id" UUID NOT NULL,
    "downstream_org_id" UUID NOT NULL,
    "downstream_lot_id" UUID NOT NULL,
    "handoff_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cross_lot_link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sharing_grant" (
    "id" UUID NOT NULL,
    "grantor_org_id" UUID NOT NULL,
    "grantee_org_id" UUID,
    "kind" TEXT NOT NULL,
    "lot_id" UUID,
    "evidence_id" UUID,
    "upstream_depth" INTEGER NOT NULL DEFAULT 0,
    "downstream_depth" INTEGER NOT NULL DEFAULT 0,
    "include_kdes" BOOLEAN NOT NULL DEFAULT false,
    "include_evidence" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by_id" UUID,

    CONSTRAINT "sharing_grant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shared_access" (
    "id" UUID NOT NULL,
    "grant_id" UUID NOT NULL,
    "grantor_org_id" UUID NOT NULL,
    "grantee_org_id" UUID NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "resource_id" UUID,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shared_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_request" (
    "id" UUID NOT NULL,
    "requester_org_id" UUID NOT NULL,
    "supplier_org_id" UUID NOT NULL,
    "requester_partner_id" UUID NOT NULL,
    "evidence_type" TEXT NOT NULL,
    "scheme" TEXT,
    "note" TEXT,
    "due_date" DATE,
    "status" TEXT NOT NULL DEFAULT 'open',
    "fulfilled_evidence_id" UUID,
    "grant_id" UUID,
    "decline_reason" TEXT,
    "created_by_id" UUID,
    "decided_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(3),

    CONSTRAINT "evidence_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_requirement" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "evidence_type" TEXT NOT NULL,
    "scheme" TEXT,
    "label" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_requirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_claim" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "partner_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "claimed_org_id" UUID,
    "claimed_by_id" UUID,
    "claimed_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_claim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "handoff_ship_event_id_key" ON "handoff"("ship_event_id");

-- CreateIndex
CREATE INDEX "handoff_receiver_org_id_status_idx" ON "handoff"("receiver_org_id", "status");

-- CreateIndex
CREATE INDEX "handoff_sender_org_id_status_idx" ON "handoff"("sender_org_id", "status");

-- CreateIndex
CREATE INDEX "cross_lot_link_downstream_lot_id_idx" ON "cross_lot_link"("downstream_lot_id");

-- CreateIndex
CREATE INDEX "cross_lot_link_upstream_lot_id_idx" ON "cross_lot_link"("upstream_lot_id");

-- CreateIndex
CREATE UNIQUE INDEX "cross_lot_link_upstream_lot_id_downstream_lot_id_key" ON "cross_lot_link"("upstream_lot_id", "downstream_lot_id");

-- CreateIndex
CREATE INDEX "sharing_grant_grantor_org_id_kind_idx" ON "sharing_grant"("grantor_org_id", "kind");

-- CreateIndex
CREATE INDEX "sharing_grant_grantee_org_id_kind_idx" ON "sharing_grant"("grantee_org_id", "kind");

-- CreateIndex
CREATE INDEX "sharing_grant_lot_id_idx" ON "sharing_grant"("lot_id");

-- CreateIndex
CREATE INDEX "sharing_grant_evidence_id_idx" ON "sharing_grant"("evidence_id");

-- CreateIndex
CREATE INDEX "shared_access_grant_id_occurred_at_idx" ON "shared_access"("grant_id", "occurred_at");

-- CreateIndex
CREATE INDEX "shared_access_grantor_org_id_occurred_at_idx" ON "shared_access"("grantor_org_id", "occurred_at");

-- CreateIndex
CREATE INDEX "evidence_request_requester_org_id_status_idx" ON "evidence_request"("requester_org_id", "status");

-- CreateIndex
CREATE INDEX "evidence_request_supplier_org_id_status_idx" ON "evidence_request"("supplier_org_id", "status");

-- CreateIndex
CREATE INDEX "supplier_requirement_org_id_idx" ON "supplier_requirement"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "partner_claim_token_hash_key" ON "partner_claim"("token_hash");

-- CreateIndex
CREATE INDEX "partner_claim_org_id_partner_id_idx" ON "partner_claim"("org_id", "partner_id");

-- ─── Two-party RLS (ADR 0008) ───────────────────────────────────────────────
ALTER TABLE "handoff" ENABLE ROW LEVEL SECURITY;
CREATE POLICY handoff_parties ON "handoff" FOR ALL TO casitrace_app
  USING (sender_org_id = casitrace_current_org() OR receiver_org_id = casitrace_current_org() OR casitrace_platform_access())
  WITH CHECK (sender_org_id = casitrace_current_org() OR receiver_org_id = casitrace_current_org() OR casitrace_platform_access());

ALTER TABLE "cross_lot_link" ENABLE ROW LEVEL SECURITY;
CREATE POLICY cross_lot_link_parties ON "cross_lot_link" FOR ALL TO casitrace_app
  USING (upstream_org_id = casitrace_current_org() OR downstream_org_id = casitrace_current_org() OR casitrace_platform_access())
  WITH CHECK (downstream_org_id = casitrace_current_org() OR casitrace_platform_access());

-- Grants: the grantor manages them; a grantee sees grants addressed to it. Grants to "all downstream
-- holders" (grantee null) are visible only to the grantor; the application checks them when tracing.
ALTER TABLE "sharing_grant" ENABLE ROW LEVEL SECURITY;
CREATE POLICY sharing_grant_parties ON "sharing_grant" FOR ALL TO casitrace_app
  USING (grantor_org_id = casitrace_current_org() OR grantee_org_id = casitrace_current_org() OR casitrace_platform_access())
  WITH CHECK (grantor_org_id = casitrace_current_org() OR casitrace_platform_access());

ALTER TABLE "shared_access" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shared_access_insert ON "shared_access" FOR INSERT TO casitrace_app
  WITH CHECK (grantee_org_id = casitrace_current_org() OR casitrace_platform_access());
CREATE POLICY shared_access_select ON "shared_access" FOR SELECT TO casitrace_app
  USING (grantor_org_id = casitrace_current_org() OR grantee_org_id = casitrace_current_org() OR casitrace_platform_access());

ALTER TABLE "evidence_request" ENABLE ROW LEVEL SECURITY;
CREATE POLICY evidence_request_parties ON "evidence_request" FOR ALL TO casitrace_app
  USING (requester_org_id = casitrace_current_org() OR supplier_org_id = casitrace_current_org() OR casitrace_platform_access())
  WITH CHECK (requester_org_id = casitrace_current_org() OR supplier_org_id = casitrace_current_org() OR casitrace_platform_access());

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['supplier_requirement','partner_claim']
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

-- ─── Append-only ────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cross_lot_link','shared_access']
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION casitrace_reject_mutation()', t || '_append_only', t);
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %I FROM casitrace_app', t);
  END LOOP;
END
$$;
-- Grants are revoked (revoked_at), never deleted.
REVOKE DELETE, TRUNCATE ON "sharing_grant" FROM casitrace_app;

-- ─── Value constraints ──────────────────────────────────────────────────────
ALTER TABLE "handoff" ADD CONSTRAINT handoff_status_values CHECK (status IN ('pending','accepted','disputed','cancelled'));
ALTER TABLE "handoff" ADD CONSTRAINT handoff_two_parties CHECK (sender_org_id <> receiver_org_id);
ALTER TABLE "sharing_grant" ADD CONSTRAINT sharing_grant_kind CHECK (
  (kind = 'lot' AND lot_id IS NOT NULL AND evidence_id IS NULL) OR
  (kind = 'evidence' AND evidence_id IS NOT NULL AND lot_id IS NULL AND grantee_org_id IS NOT NULL));
ALTER TABLE "sharing_grant" ADD CONSTRAINT sharing_grant_depths CHECK (upstream_depth BETWEEN 0 AND 20 AND downstream_depth BETWEEN 0 AND 20);
ALTER TABLE "sharing_grant" ADD CONSTRAINT sharing_grant_not_self CHECK (grantee_org_id IS NULL OR grantee_org_id <> grantor_org_id);
ALTER TABLE "evidence_request" ADD CONSTRAINT evidence_request_status_values CHECK (status IN ('open','fulfilled','declined','cancelled'));
ALTER TABLE "trading_partner" ADD CONSTRAINT trading_partner_approval_values CHECK (approval_status IN ('pending','approved','suspended'));
