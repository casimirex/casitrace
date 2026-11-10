-- DropIndex
DROP INDEX "lot_org_id_product_id_lot_code_key";

-- CreateIndex
CREATE INDEX "lot_org_id_product_id_lot_code_idx" ON "lot"("org_id", "product_id", "lot_code");

-- A voided lot keeps its code for the record; a replacement may reuse it.
CREATE UNIQUE INDEX "lot_code_unique_unless_voided" ON "lot" ("org_id", "product_id", "lot_code") WHERE status <> 'voided';
