import { z } from "@hono/zod-openapi";
import { EVIDENCE_TYPES } from "./evidence";

export const HANDOFF_STATUSES = ["pending", "accepted", "disputed", "cancelled"] as const;

export const ShareOptions = z
  .object({
    upstreamDepth: z.number().int().min(0).max(20).default(5),
    includeKdes: z.boolean().default(true),
    includeEvidence: z.boolean().default(false),
  })
  .openapi("ShareOptions", { description: "What the receiver may see of the shipped lots' history." });

export const HandoffLine = z.object({
  senderLotId: z.uuid(),
  lotCode: z.string(),
  productSku: z.string(),
  productName: z.string(),
  gtin: z.string().nullable(),
  category: z.string(),
  quantity: z.string(),
  uomCode: z.string(),
});

export const HandoffDto = z
  .object({
    id: z.uuid(),
    direction: z.enum(["incoming", "outgoing"]),
    status: z.enum(HANDOFF_STATUSES),
    counterparty: z.object({ id: z.uuid(), name: z.string(), verified: z.boolean() }),
    shippedAt: z.iso.datetime(),
    lines: z.array(HandoffLine),
    shipmentRef: z.string().nullable(),
    disputeReason: z.string().nullable(),
    decidedAt: z.iso.datetime().nullable(),
    receivedLots: z.array(z.object({ senderLotId: z.uuid(), lotId: z.uuid(), lotCode: z.string() })),
    sharedHistory: z.boolean(),
  })
  .openapi("Handoff");

export const AcceptHandoff = z
  .object({
    lines: z
      .array(
        z.object({
          senderLotId: z.uuid(),
          productId: z.uuid(),
          lotCode: z.string().trim().min(1).max(60).optional(),
          quantity: z
            .string()
            .regex(/^\d+(\.\d{1,6})?$/)
            .optional(),
          locationId: z.uuid().optional(),
        }),
      )
      .min(1),
    occurredAt: z.iso.datetime({ offset: true }).optional(),
  })
  .openapi("AcceptHandoff");

export const DisputeHandoff = z
  .object({ reason: z.string().trim().min(5).max(1000) })
  .openapi("DisputeHandoff");

export const GrantInput = z
  .object({
    granteeOrgId: z.uuid().nullable(),
    lotId: z.uuid(),
    upstreamDepth: z.number().int().min(0).max(20).default(5),
    downstreamDepth: z.number().int().min(0).max(20).default(0),
    includeKdes: z.boolean().default(true),
    includeEvidence: z.boolean().default(false),
    note: z.string().trim().max(500).optional(),
  })
  .openapi("GrantInput", { description: "granteeOrgId null = every organisation downstream of the lot" });

export const GrantDto = z
  .object({
    id: z.uuid(),
    kind: z.enum(["lot", "evidence"]),
    grantor: z.object({ id: z.uuid(), name: z.string() }),
    grantee: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    lot: z.object({ id: z.uuid(), lotCode: z.string() }).nullable(),
    evidence: z.object({ id: z.uuid(), title: z.string() }).nullable(),
    upstreamDepth: z.number().int(),
    downstreamDepth: z.number().int(),
    includeKdes: z.boolean(),
    includeEvidence: z.boolean(),
    note: z.string().nullable(),
    createdAt: z.iso.datetime(),
    revokedAt: z.iso.datetime().nullable(),
    accessCount: z.number().int(),
    lastAccessAt: z.iso.datetime().nullable(),
  })
  .openapi("Grant");

export const EvidenceRequestInput = z
  .object({
    partnerId: z.uuid(),
    evidenceType: z.enum(EVIDENCE_TYPES),
    scheme: z.string().trim().max(120).optional(),
    note: z.string().trim().max(1000).optional(),
    dueDate: z.iso.date().optional(),
  })
  .openapi("EvidenceRequestInput");

export const EvidenceRequestDto = z
  .object({
    id: z.uuid(),
    direction: z.enum(["outgoing", "incoming"]),
    counterparty: z.object({ id: z.uuid(), name: z.string() }),
    evidenceType: z.enum(EVIDENCE_TYPES),
    scheme: z.string().nullable(),
    note: z.string().nullable(),
    dueDate: z.iso.date().nullable(),
    status: z.enum(["open", "fulfilled", "declined", "cancelled"]),
    declineReason: z.string().nullable(),
    fulfilledEvidence: z.object({ id: z.uuid(), title: z.string() }).nullable(),
    createdAt: z.iso.datetime(),
    decidedAt: z.iso.datetime().nullable(),
  })
  .openapi("EvidenceRequest");

export const SupplierRequirementInput = z
  .object({
    evidenceType: z.enum(EVIDENCE_TYPES),
    scheme: z.string().trim().max(120).optional(),
    label: z.string().trim().min(2).max(200),
  })
  .openapi("SupplierRequirementInput");
export const SupplierRequirementDto = SupplierRequirementInput.extend({
  id: z.uuid(),
  scheme: z.string().nullable(),
}).openapi("SupplierRequirement");

export const PartnerCompliance = z
  .object({
    partnerId: z.uuid(),
    approvalStatus: z.enum(["pending", "approved", "suspended"]),
    approvedAt: z.iso.datetime().nullable(),
    requirementsMet: z.boolean(),
    requirements: z.array(
      z.object({
        requirement: SupplierRequirementDto,
        met: z.boolean(),
        evidence: z.array(
          z.object({
            id: z.uuid(),
            title: z.string(),
            status: z.string(),
            validUntil: z.iso.date().nullable(),
            source: z.enum(["uploaded_by_us", "shared_by_supplier"]),
          }),
        ),
      }),
    ),
  })
  .openapi("PartnerCompliance");

export const ClaimInvite = z.object({ email: z.email() }).openapi("ClaimInvite");
export const ClaimInfo = z
  .object({
    inviterName: z.string(),
    partnerName: z.string(),
    email: z.string(),
    expiresAt: z.iso.datetime(),
    claimed: z.boolean(),
  })
  .openapi("ClaimInfo");
export const ClaimAccept = z.object({ organizationId: z.uuid() }).openapi("ClaimAccept");
