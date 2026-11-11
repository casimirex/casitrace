/**
 * Plain-language labels for audit actions and key data elements (audit F-5). Unknown codes fall back
 * to a readable version of the code, so a new action never shows up blank.
 */
const ACTIONS: Record<string, string> = {
  "organisation.created": "Created the business",
  "organisation.updated": "Updated the business",
  "organisation.verified": "Business verified by Casitrace",
  "organisation.verification_rejected": "Verification not approved",
  "organisation.verification_requested": "Asked Casitrace to verify the business",
  "invitation.created": "Invited someone",
  "invitation.accepted": "Accepted an invitation",
  "invitation.cancelled": "Cancelled an invitation",
  "invitation.rejected": "Declined an invitation",
  "member.role_changed": "Changed someone's role",
  "member.removed": "Removed a member",
  "member.left": "Left the business",
  "location.created": "Added a location",
  "location.updated": "Updated a location",
  "location.archived": "Archived a location",
  "partner.created": "Added a partner",
  "partner.updated": "Updated a partner",
  "partner.archived": "Archived a partner",
  "partner.claim_invited": "Invited a partner to join",
  "partner.claimed": "A partner joined and claimed its record",
  "product.created": "Added a product",
  "product.revised": "Changed a product (new version)",
  "product.revision_unchanged": "Saved a product without changes",
  "import.completed": "Imported a spreadsheet",
  "evidence.uploaded": "Uploaded a document",
  "evidence.updated": "Edited a document's details",
  "evidence.file_replaced": "Replaced a document's file",
  "evidence.linked": "Linked a document",
  "evidence.unlinked": "Unlinked a document",
  "evidence.downloaded": "Downloaded a document",
  "evidence.integrity_checked": "Checked a document's fingerprint",
  "evidence.scan_clean": "Document passed the virus scan",
  "evidence.scan_infected": "Document failed the virus scan",
  "evidence.checked": "Document checked",
  "evidence.verified": "Verified a document",
  "evidence.rejected": "Rejected a document",
  "evidence.revoked": "Revoked a document",
  "evidence.expired": "A certificate expired",
  "evidence_request.created": "Asked a partner for a document",
  "evidence_request.fulfilled": "Answered a document request",
  "evidence_request.declined": "Declined a document request",
  "evidence_request.cancelled": "Cancelled a document request",
  "supplier_requirement.added": "Added a supplier requirement",
  "supplier_requirement.removed": "Removed a supplier requirement",
  "trace.event_recorded": "Recorded an event",
  "trace.event_replayed": "Sent an event again (already recorded)",
  "trace.event_voided": "Cancelled an event",
  "lot.held": "Put a lot on hold",
  "lot.released": "Released a lot from hold",
  "handoff.accepted": "Booked in a delivery",
  "handoff.disputed": "Disputed a delivery",
  "share.granted": "Shared history with a partner",
  "share.revoked": "Stopped sharing with a partner",
  "shared_evidence.downloaded": "Downloaded a partner's shared document",
  "passport.created": "Started a public page",
  "passport.disclosure_changed": "Changed what a public page shows",
  "passport.published": "Published a public page",
  "passport.withdrawn": "Withdrew a public page",
  "recall.started": "Started a recall",
  "recall.drill_started": "Started a mock recall",
  "recall.exported": "Exported a recall contact list",
  "recall.acknowledged": "Recorded a customer's confirmation",
  "recall.notice_acknowledged": "Acknowledged a supplier's recall",
  "recall.closed": "Closed a recall",
};

export const actionLabel = (code: string) => {
  const known = ACTIONS[code];
  if (known) return known;
  const text = code.replace(/[._]/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/** Key data element names as people say them. */
const KDE_LABELS: Record<string, string> = {
  cultivars: "Variety",
  harvestMethod: "Harvest method",
  harvestEndedAt: "Harvest ended",
  extractionMethod: "Extraction",
  malaxationMaxTempC: "Highest mixing temperature",
  malaxationMinutes: "Mixing time",
  storageTank: "Tank",
  bestBefore: "Best before",
  line: "Bottling line",
  supplierLotCode: "Supplier's lot code",
  deliveryNote: "Delivery note",
  grossKg: "Gross weight",
  rejectedKg: "Rejected",
  condition: "Condition on arrival",
  shipmentRef: "Shipment reference",
  description: "Description",
  reason: "Reason",
};
const KDE_UNITS: Record<string, string> = {
  malaxationMaxTempC: " °C",
  malaxationMinutes: " min",
  grossKg: " kg",
  rejectedKg: " kg",
};
const VALUE_LABELS: Record<string, string> = {
  two_phase: "two-phase",
  three_phase: "three-phase",
  press: "press",
  hand: "by hand",
  mechanical: "mechanical",
  net: "nets",
};

export const kdeEntries = (kdes: Record<string, unknown>) =>
  Object.entries(kdes)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => {
      const raw = Array.isArray(v) ? v.join(", ") : String(v);
      const value = `${VALUE_LABELS[raw] ?? raw}${KDE_UNITS[k] ?? ""}`;
      return {
        key: k,
        label: KDE_LABELS[k] ?? actionLabel(k.replace(/([A-Z])/g, " $1").toLowerCase()),
        value,
      };
    });
