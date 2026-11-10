-- CreateTable
CREATE TABLE "lot" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "product_version_id" UUID NOT NULL,
    "lot_code" TEXT NOT NULL,
    "uom_code" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "initial_quantity" DECIMAL(18,6) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "hold_reason" TEXT,
    "location_id" UUID,
    "created_by_event_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "lot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trace_event" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "process" TEXT,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "location_id" UUID,
    "partner_id" UUID,
    "kdes" JSONB NOT NULL,
    "kde_schema" TEXT NOT NULL,
    "note" TEXT,
    "voids_event_id" UUID,
    "override_reason" TEXT,
    "mass_balance" JSONB,
    "idempotency_key" TEXT,
    "request_hash" TEXT,
    "actor_id" UUID,

    CONSTRAINT "trace_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trace_event_line" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "uom_code" TEXT NOT NULL,

    CONSTRAINT "trace_event_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lot_edge" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "parent_lot_id" UUID NOT NULL,
    "child_lot_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,

    CONSTRAINT "lot_edge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lot_org_id_status_idx" ON "lot"("org_id", "status");

-- CreateIndex
CREATE INDEX "lot_org_id_lot_code_idx" ON "lot"("org_id", "lot_code");

-- CreateIndex
CREATE UNIQUE INDEX "lot_org_id_product_id_lot_code_key" ON "lot"("org_id", "product_id", "lot_code");

-- CreateIndex
CREATE UNIQUE INDEX "trace_event_voids_event_id_key" ON "trace_event"("voids_event_id");

-- CreateIndex
CREATE INDEX "trace_event_org_id_occurred_at_idx" ON "trace_event"("org_id", "occurred_at");

-- CreateIndex
CREATE INDEX "trace_event_org_id_type_idx" ON "trace_event"("org_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "trace_event_org_id_idempotency_key_key" ON "trace_event"("org_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "trace_event_line_lot_id_idx" ON "trace_event_line"("lot_id");

-- CreateIndex
CREATE INDEX "trace_event_line_event_id_idx" ON "trace_event_line"("event_id");

-- CreateIndex
CREATE INDEX "lot_edge_parent_lot_id_idx" ON "lot_edge"("parent_lot_id");

-- CreateIndex
CREATE INDEX "lot_edge_child_lot_id_idx" ON "lot_edge"("child_lot_id");

-- CreateIndex
CREATE UNIQUE INDEX "lot_edge_parent_lot_id_child_lot_id_event_id_key" ON "lot_edge"("parent_lot_id", "child_lot_id", "event_id");

-- AddForeignKey
ALTER TABLE "trace_event_line" ADD CONSTRAINT "trace_event_line_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "trace_event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Row-level security (ADR 0008) ──────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['lot','trace_event','trace_event_line','lot_edge']
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

-- ─── Append-only (ADR 0007): events, lines and genealogy are never changed ──
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['trace_event','trace_event_line','lot_edge']
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I
                    FOR EACH ROW EXECUTE FUNCTION casitrace_reject_mutation()', t || '_append_only', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I
                    FOR EACH STATEMENT EXECUTE FUNCTION casitrace_reject_mutation()', t || '_no_truncate', t);
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %I FROM casitrace_app', t);
  END LOOP;
END
$$;
REVOKE DELETE, TRUNCATE ON "lot" FROM casitrace_app;

-- ─── Value constraints ──────────────────────────────────────────────────────
ALTER TABLE "trace_event" ADD CONSTRAINT trace_event_type_values
  CHECK (type IN ('ORIGINATE','RECEIVE','TRANSFORM','SHIP','ADJUST','VOID'));
ALTER TABLE "trace_event" ADD CONSTRAINT trace_event_void_ref CHECK ((type = 'VOID') = (voids_event_id IS NOT NULL));
ALTER TABLE "trace_event_line" ADD CONSTRAINT trace_event_line_role_values CHECK (role IN ('input','output','adjust'));
ALTER TABLE "trace_event_line" ADD CONSTRAINT trace_event_line_quantity
  CHECK ((role = 'adjust' AND quantity <> 0) OR (role <> 'adjust' AND quantity > 0));
ALTER TABLE "lot" ADD CONSTRAINT lot_status_values
  CHECK (status IN ('active','consumed','shipped','on_hold','recalled','voided'));
ALTER TABLE "lot" ADD CONSTRAINT lot_quantity_non_negative CHECK (quantity >= 0);
ALTER TABLE "lot_edge" ADD CONSTRAINT lot_edge_no_self CHECK (parent_lot_id <> child_lot_id);

-- Evidence can now point at lots and events.
