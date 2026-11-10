import { z } from "@hono/zod-openapi";

export const EVIDENCE_TYPES = [
  "certificate",
  "lab_report",
  "inspection_report",
  "supplier_declaration",
  "delivery_note",
  "photo",
  "other",
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

/** roadmap-v2 §4.4. A hash proves a file is unchanged, not that its content is true. */
export const EVIDENCE_STATUSES = [
  "submitted",
  "checked",
  "verified",
  "rejected",
  "expired",
  "revoked",
] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

export const EVIDENCE_TARGETS = [
  "organisation",
  "location",
  "partner",
  "product",
  "product_version",
  "lot",
  "event",
] as const;
export type EvidenceTarget = (typeof EVIDENCE_TARGETS)[number];

/** Common certification schemes for the olive-oil pilot; free text is also accepted. */
export const CERTIFICATE_SCHEMES = [
  "EU organic (Reg. 2018/848)",
  "PDO",
  "PGI",
  "BRCGS Food Safety",
  "IFS Food",
  "ISO 22000",
  "FSSC 22000",
  "GlobalG.A.P.",
  "Kosher",
  "Halal",
] as const;

export const MAX_EVIDENCE_BYTES = 25 * 1024 * 1024;

const isoDate = z.iso.date().openapi({ example: "2027-06-30" });
const optText = (max: number) => z.string().trim().max(max).optional().nullable();

export const CertificateFields = z.object({
  scheme: optText(120),
  issuerName: optText(200),
  issuerPartnerId: z.uuid().optional().nullable(),
  certificateNumber: optText(100),
  scope: optText(1000),
  validFrom: isoDate.optional().nullable(),
  validUntil: isoDate.optional().nullable(),
});

export const EvidenceMetadata = z
  .object({
    type: z.enum(EVIDENCE_TYPES),
    title: z.string().trim().min(1).max(200),
    description: optText(2000),
    links: z
      .array(z.object({ targetType: z.enum(EVIDENCE_TARGETS), targetId: z.uuid() }))
      .max(50)
      .default([]),
  })
  .extend(CertificateFields.shape)
  .superRefine((v, ctx) => {
    if (v.type === "certificate") {
      for (const f of ["scheme", "issuerName", "validUntil"] as const) {
        if (!v[f]) ctx.addIssue({ code: "custom", path: [f], message: "Required for a certificate" });
      }
    }
    if (v.validFrom && v.validUntil && v.validFrom > v.validUntil) {
      ctx.addIssue({ code: "custom", path: ["validUntil"], message: "Must be on or after the start date" });
    }
  })
  .openapi("EvidenceMetadata");
export type EvidenceMetadata = z.infer<typeof EvidenceMetadata>;

export const EvidenceUpdate = z
  .object({ title: z.string().trim().min(1).max(200), description: optText(2000) })
  .extend(CertificateFields.shape)
  .openapi("EvidenceUpdate");

export const EvidenceUpload = z
  .object({
    file: z.file().openapi({ type: "string", format: "binary" }),
    metadata: z.string().openapi({ description: "EvidenceMetadata as a JSON string" }),
  })
  .openapi("EvidenceUpload");

export const EvidenceNewVersion = z
  .object({ file: z.file().openapi({ type: "string", format: "binary" }) })
  .openapi("EvidenceNewVersion");

export const ReviewAction = z
  .object({
    action: z.enum(["verify", "reject", "revoke"]),
    reason: z.string().trim().max(1000).optional(),
  })
  .openapi("ReviewAction");

export const EvidenceFileDto = z.object({
  version: z.number().int(),
  sha256: z.string(),
  sizeBytes: z.number().int(),
  mediaType: z.string(),
  originalName: z.string(),
  uploadedById: z.uuid().nullable(),
  uploadedAt: z.iso.datetime(),
  scanStatus: z.enum(["pending", "clean", "infected", "error"]),
  scannedAt: z.iso.datetime().nullable(),
});

export const EvidenceSummary = z
  .object({
    id: z.uuid(),
    type: z.enum(EVIDENCE_TYPES),
    title: z.string(),
    status: z.enum(EVIDENCE_STATUSES),
    currentFileVersion: z.number().int(),
    scheme: z.string().nullable(),
    issuerName: z.string().nullable(),
    certificateNumber: z.string().nullable(),
    validUntil: isoDate.nullable(),
    daysUntilExpiry: z.number().int().nullable(),
    linkCount: z.number().int(),
    updatedAt: z.iso.datetime(),
  })
  .openapi("EvidenceSummary");

export const Evidence = EvidenceSummary.extend({
  description: z.string().nullable(),
  issuerPartnerId: z.uuid().nullable(),
  scope: z.string().nullable(),
  validFrom: isoDate.nullable(),
  createdById: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  files: z.array(EvidenceFileDto),
  links: z.array(
    z.object({
      id: z.uuid(),
      targetType: z.enum(EVIDENCE_TARGETS),
      targetId: z.uuid(),
      label: z.string().nullable(),
    }),
  ),
  history: z.array(
    z.object({
      fromStatus: z.string().nullable(),
      toStatus: z.string(),
      reason: z.string().nullable(),
      actorType: z.string(),
      actorId: z.uuid().nullable(),
      fileVersion: z.number().int().nullable(),
      occurredAt: z.iso.datetime(),
    }),
  ),
}).openapi("Evidence");

export const DownloadLink = z
  .object({ url: z.string(), expiresAt: z.iso.datetime(), sha256: z.string(), fileName: z.string() })
  .openapi("DownloadLink");

export const IntegrityCheck = z
  .object({
    version: z.number().int(),
    storedSha256: z.string(),
    actualSha256: z.string(),
    match: z.boolean(),
    checkedAt: z.iso.datetime(),
  })
  .openapi("IntegrityCheck");

export const NotificationDto = z
  .object({
    id: z.uuid(),
    orgId: z.uuid().nullable(),
    kind: z.string(),
    title: z.string(),
    body: z.string(),
    link: z.string().nullable(),
    readAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
  })
  .openapi("Notification");
