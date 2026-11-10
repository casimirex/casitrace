import { z } from "@hono/zod-openapi";
import { gs1CheckDigitValid } from "./identifiers";
import { UomCode } from "./master-data";

export const EVENT_TYPES = ["ORIGINATE", "RECEIVE", "TRANSFORM", "SHIP", "ADJUST", "VOID"] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export const TRANSFORM_PROCESSES = ["milling", "blending", "bottling", "split", "other"] as const;
export const LOT_STATUSES = ["active", "consumed", "shipped", "on_hold", "recalled", "voided"] as const;

/** Decimal quantities travel as strings or numbers and are parsed exactly (ADR 0006). */
export const Quantity = z
  .union([
    z.string().regex(/^\d+(\.\d{1,6})?$/, "Use a positive number with up to 6 decimals"),
    z.number().positive(),
  ])
  .transform((v) => String(v))
  .refine((v) => Number(v) > 0, "Must be greater than zero")
  .openapi({ type: "string", example: "1250.5" });
export const SignedQuantity = z
  .union([z.string().regex(/^-?\d+(\.\d{1,6})?$/), z.number()])
  .transform((v) => String(v))
  .refine((v) => Number(v) !== 0, "Must not be zero")
  .openapi({ type: "string", example: "-12.5" });

const Sscc = z
  .string()
  .regex(/^\d{18}$/, "SSCC has 18 digits")
  .refine(gs1CheckDigitValid, "SSCC check digit is wrong");
const cultivars = z.array(z.string().trim().min(1).max(60)).min(1).max(20);

/**
 * Key data elements per event (docs/business/kde-cte-matrix.md). Each schema has a version label stored
 * on the event; never change a released schema, add a new label.
 */
export const KDE_SCHEMAS = {
  "ORIGINATE.harvest": {
    version: "originate.harvest@1",
    schema: z
      .object({
        cultivars,
        harvestMethod: z.enum(["hand", "mechanical", "net", "other"]).optional(),
        harvestEndedAt: z.iso.datetime().optional(),
      })
      .strict(),
  },
  "ORIGINATE.other": {
    version: "originate.other@1",
    schema: z.object({ description: z.string().max(500).optional() }).strict(),
  },
  RECEIVE: {
    version: "receive@1",
    schema: z
      .object({
        supplierLotCode: z.string().trim().max(60).optional(),
        deliveryNote: z.string().trim().max(60).optional(),
        grossKg: z.number().positive().optional(),
        rejectedKg: z.number().min(0).optional(),
        condition: z.string().trim().max(500).optional(),
      })
      .strict(),
  },
  "TRANSFORM.milling": {
    version: "transform.milling@1",
    schema: z
      .object({
        extractionMethod: z.enum(["two_phase", "three_phase", "press", "other"]),
        malaxationMaxTempC: z.number().min(0).max(60),
        malaxationMinutes: z.number().int().min(0).max(600).optional(),
        storageTank: z.string().trim().max(60).optional(),
      })
      .strict(),
  },
  "TRANSFORM.blending": {
    version: "transform.blending@1",
    schema: z.object({ storageTank: z.string().trim().max(60).optional() }).strict(),
  },
  "TRANSFORM.bottling": {
    version: "transform.bottling@1",
    schema: z.object({ bestBefore: z.iso.date(), line: z.string().trim().max(60).optional() }).strict(),
  },
  "TRANSFORM.split": { version: "transform.split@1", schema: z.object({}).strict() },
  "TRANSFORM.other": {
    version: "transform.other@1",
    schema: z.object({ description: z.string().trim().min(1).max(500) }).strict(),
  },
  SHIP: {
    version: "ship@1",
    schema: z
      .object({
        shipmentRef: z.string().trim().max(60).optional(),
        sscc: Sscc.optional(),
        carrier: z.string().trim().max(100).optional(),
      })
      .strict(),
  },
  ADJUST: {
    version: "adjust@1",
    schema: z.object({ reason: z.enum(["recount", "loss", "spillage", "sample", "other"]) }).strict(),
  },
  VOID: { version: "void@1", schema: z.object({}).strict() },
} as const;
export type KdeKey = keyof typeof KDE_SCHEMAS;
export const kdeKey = (type: EventType, process?: string | null): KdeKey => {
  if (type === "ORIGINATE") return process === "harvest" ? "ORIGINATE.harvest" : "ORIGINATE.other";
  if (type === "TRANSFORM") return `TRANSFORM.${process ?? "other"}` as KdeKey;
  return type as KdeKey;
};

export const InputLine = z.object({ lotId: z.uuid(), quantity: Quantity, uomCode: UomCode.optional() });
export const OutputLine = z.object({
  productId: z.uuid(),
  lotCode: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[A-Za-z0-9._/-]+$/, "Letters, digits and . _ / - only")
    .optional(),
  quantity: Quantity,
  uomCode: UomCode.optional(),
  locationId: z.uuid().optional(),
});

export const RecordEvent = z
  .object({
    type: z.enum(["ORIGINATE", "RECEIVE", "TRANSFORM", "SHIP", "ADJUST"]),
    process: z.enum(["harvest", ...TRANSFORM_PROCESSES]).optional(),
    occurredAt: z.iso.datetime({ offset: true }),
    locationId: z.uuid().optional(),
    partnerId: z.uuid().optional(),
    kdes: z.record(z.string(), z.unknown()).default({}),
    inputs: z.array(InputLine).max(200).default([]),
    outputs: z.array(OutputLine).max(200).default([]),
    adjust: z.object({ lotId: z.uuid(), delta: SignedQuantity }).optional(),
    note: z.string().trim().max(1000).optional(),
    /** Accept an event that fails the mass-balance check (needs event:override). */
    overrideMassBalance: z.object({ reason: z.string().trim().min(5).max(500) }).optional(),
    /** Client-generated key so a retried submission (e.g. from an offline queue) is recorded once. */
    idempotencyKey: z.string().min(8).max(100).optional(),
    /** SHIP to an organisation on Casitrace: share the shipped lots' history with it. */
    share: z
      .object({
        upstreamDepth: z.number().int().min(0).max(20).default(5),
        includeKdes: z.boolean().default(true),
        includeEvidence: z.boolean().default(false),
      })
      .optional(),
  })
  .openapi("RecordEvent");
export type RecordEvent = z.infer<typeof RecordEvent>;

export const VoidEvent = z
  .object({
    reason: z.string().trim().min(5).max(500),
    replacement: RecordEvent.optional(),
  })
  .openapi("VoidEvent", {
    description: "Voids an event; optionally records its corrected replacement in the same transaction.",
  });

const LotRef = z.object({
  id: z.uuid(),
  lotCode: z.string(),
  productId: z.uuid(),
  productSku: z.string(),
  productName: z.string(),
  productVersion: z.number().int(),
});

export const EventLineDto = z.object({
  role: z.enum(["input", "output", "adjust"]),
  quantity: z.string(),
  uomCode: z.string(),
  lot: LotRef,
});

export const TraceEventDto = z
  .object({
    id: z.uuid(),
    type: z.enum(EVENT_TYPES),
    process: z.string().nullable(),
    occurredAt: z.iso.datetime(),
    recordedAt: z.iso.datetime(),
    location: z.object({ id: z.uuid(), code: z.string(), name: z.string() }).nullable(),
    partner: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    kdes: z.record(z.string(), z.unknown()),
    kdeSchema: z.string(),
    note: z.string().nullable(),
    voidsEventId: z.uuid().nullable(),
    voidedBy: z
      .object({ id: z.uuid(), reason: z.string().nullable(), recordedAt: z.iso.datetime() })
      .nullable(),
    overrideReason: z.string().nullable(),
    massBalance: z.unknown().nullable(),
    actorId: z.uuid().nullable(),
    lines: z.array(EventLineDto),
  })
  .openapi("TraceEvent");

export const LotDto = z
  .object({
    id: z.uuid(),
    lotCode: z.string(),
    product: z.object({
      id: z.uuid(),
      sku: z.string(),
      name: z.string(),
      version: z.number().int(),
      versionId: z.uuid(),
      category: z.string(),
    }),
    uomCode: z.string(),
    quantity: z.string(),
    initialQuantity: z.string(),
    status: z.enum(LOT_STATUSES),
    holdReason: z.string().nullable(),
    location: z.object({ id: z.uuid(), code: z.string(), name: z.string() }).nullable(),
    createdByEventId: z.uuid(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .openapi("Lot");

export const LotDetail = LotDto.extend({ events: z.array(TraceEventDto) }).openapi("LotDetail");

export const TraceNode = z.object({
  /** Lot ID, or for a redacted node an opaque placeholder ID. */
  lotId: z.uuid(),
  /** The organisation holding the lot. */
  org: z.object({ id: z.uuid(), name: z.string(), verified: z.boolean() }),
  /** True when the holder has not shared this part of the chain: only the organisation is shown. */
  redacted: z.boolean(),
  lotCode: z.string(),
  productSku: z.string(),
  productName: z.string(),
  status: z.string(),
  quantity: z.string(),
  initialQuantity: z.string(),
  uomCode: z.string(),
  /** Negative = upstream (inputs), 0 = the lot traced, positive = downstream. */
  depth: z.number().int(),
  origin: z
    .object({
      eventType: z.string(),
      occurredAt: z.iso.datetime(),
      location: z.string().nullable(),
      partner: z.string().nullable(),
    })
    .nullable(),
});
export const TraceEdge = z.object({
  parentLotId: z.uuid(),
  childLotId: z.uuid(),
  eventId: z.uuid(),
  process: z.string().nullable(),
});
export const TraceShipment = z.object({
  lotId: z.uuid(),
  eventId: z.uuid(),
  partnerId: z.uuid().nullable(),
  partnerName: z.string().nullable(),
  quantity: z.string(),
  uomCode: z.string(),
  occurredAt: z.iso.datetime(),
});
export const TraceResult = z
  .object({
    rootLotId: z.uuid(),
    direction: z.enum(["backward", "forward", "both"]),
    nodes: z.array(TraceNode),
    edges: z.array(TraceEdge),
    /** Downstream: who received product from these lots. */
    shipments: z.array(TraceShipment),
    /** Upstream: which suppliers delivered the origin lots. */
    suppliers: z.array(
      z.object({
        lotId: z.uuid(),
        partnerId: z.uuid().nullable(),
        partnerName: z.string().nullable(),
        supplierLotCode: z.string().nullable(),
      }),
    ),
    truncated: z.boolean(),
    maxDepth: z.number().int(),
    elapsedMs: z.number(),
  })
  .openapi("TraceResult");
export type TraceResult = z.infer<typeof TraceResult>;
