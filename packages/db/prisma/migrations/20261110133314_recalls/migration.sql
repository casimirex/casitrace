-- CreateTable
CREATE TABLE "recall_case" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "reason" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "instructions" TEXT,
    "impact" JSONB,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_by_id" UUID,
    "impact_at" TIMESTAMPTZ(3),
    "exported_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "closed_by_id" UUID,
    "close_note" TEXT,

    CONSTRAINT "recall_case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recall_lot" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "depth" INTEGER NOT NULL,

    CONSTRAINT "recall_lot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recall_notice" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "partner_id" UUID NOT NULL,
    "recipient_org_id" UUID,
    "channel" TEXT NOT NULL,
    "shipments" JSONB NOT NULL,
    "notified_at" TIMESTAMPTZ(3),
    "acknowledged_at" TIMESTAMPTZ(3),
    "acknowledged_by_id" UUID,
    "ack_note" TEXT,

    CONSTRAINT "recall_notice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recall_case_org_id_status_idx" ON "recall_case"("org_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "recall_case_org_id_code_key" ON "recall_case"("org_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "recall_lot_case_id_lot_id_key" ON "recall_lot"("case_id", "lot_id");

-- CreateIndex
CREATE INDEX "recall_notice_recipient_org_id_idx" ON "recall_notice"("recipient_org_id");

-- CreateIndex
CREATE UNIQUE INDEX "recall_notice_case_id_partner_id_key" ON "recall_notice"("case_id", "partner_id");

-- AddForeignKey
ALTER TABLE "recall_lot" ADD CONSTRAINT "recall_lot_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "recall_case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_notice" ADD CONSTRAINT "recall_notice_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "recall_case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "recall_case" ENABLE ROW LEVEL SECURITY;
CREATE POLICY recall_case_tenant ON "recall_case" FOR ALL TO casitrace_app
  USING (org_id = casitrace_current_org() OR casitrace_platform_access())
  WITH CHECK (org_id = casitrace_current_org() OR casitrace_platform_access());
ALTER TABLE "recall_lot" ENABLE ROW LEVEL SECURITY;
CREATE POLICY recall_lot_tenant ON "recall_lot" FOR ALL TO casitrace_app
  USING (org_id = casitrace_current_org() OR casitrace_platform_access())
  WITH CHECK (org_id = casitrace_current_org() OR casitrace_platform_access());
-- Notices: the recalling organisation and the notified customer both see the row.
ALTER TABLE "recall_notice" ENABLE ROW LEVEL SECURITY;
CREATE POLICY recall_notice_parties ON "recall_notice" FOR ALL TO casitrace_app
  USING (org_id = casitrace_current_org() OR recipient_org_id = casitrace_current_org() OR casitrace_platform_access())
  WITH CHECK (org_id = casitrace_current_org() OR recipient_org_id = casitrace_current_org() OR casitrace_platform_access());

REVOKE DELETE, TRUNCATE ON "recall_case", "recall_lot", "recall_notice" FROM casitrace_app;
ALTER TABLE "recall_case" ADD CONSTRAINT recall_case_values CHECK (mode IN ('real','drill') AND status IN ('open','closed')
  AND severity IN ('health_risk','quality','regulatory','other'));
ALTER TABLE "recall_notice" ADD CONSTRAINT recall_notice_channel CHECK (channel IN ('platform','external') AND ((channel = 'platform') = (recipient_org_id IS NOT NULL)));
