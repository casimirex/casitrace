import { z } from "@hono/zod-openapi";

export const RECALL_SEVERITIES = ["health_risk", "quality", "regulatory", "other"] as const;

export const StartRecall = z
  .object({
    mode: z.enum(["real", "drill"]),
    lotIds: z.array(z.uuid()).min(1).max(50),
    reason: z.string().trim().min(5).max(1000),
    severity: z.enum(RECALL_SEVERITIES),
    instructions: z.string().trim().max(2000).optional(),
  })
  .openapi("StartRecall", {
    description:
      "mode=drill runs the same flow without flagging lots or notifying anyone outside the organisation",
  });

const ImpactLot = z.object({
  lotId: z.uuid(),
  lotCode: z.string(),
  productName: z.string(),
  org: z.object({ id: z.uuid(), name: z.string() }),
  depth: z.number().int(),
  quantity: z.string(),
  uomCode: z.string(),
  status: z.string(),
  redacted: z.boolean(),
});

export const RecallNoticeDto = z.object({
  id: z.uuid(),
  partner: z.object({
    id: z.uuid(),
    name: z.string(),
    email: z.string().nullable(),
    city: z.string().nullable(),
    countryCode: z.string().nullable(),
  }),
  channel: z.enum(["platform", "external"]),
  shipments: z.array(
    z.object({ lotCode: z.string(), quantity: z.string(), uomCode: z.string(), shippedAt: z.iso.datetime() }),
  ),
  notifiedAt: z.iso.datetime().nullable(),
  acknowledgedAt: z.iso.datetime().nullable(),
  ackNote: z.string().nullable(),
});

export const RecallDto = z
  .object({
    id: z.uuid(),
    code: z.string(),
    mode: z.enum(["real", "drill"]),
    status: z.enum(["open", "closed"]),
    reason: z.string(),
    severity: z.enum(RECALL_SEVERITIES),
    instructions: z.string().nullable(),
    startedAt: z.iso.datetime(),
    impactAt: z.iso.datetime().nullable(),
    exportedAt: z.iso.datetime().nullable(),
    closedAt: z.iso.datetime().nullable(),
    /** Start → first export of the impact set, in seconds (the drill measure). */
    secondsToExport: z.number().nullable(),
    impact: z
      .object({
        lots: z.array(ImpactLot),
        ownLotsFlagged: z.number().int(),
        customers: z.number().int(),
        locations: z.array(z.string()),
        redactedOrganisations: z.array(z.string()),
        truncated: z.boolean(),
      })
      .nullable(),
    notices: z.array(RecallNoticeDto),
  })
  .openapi("Recall");

export const IncomingRecallNotice = z
  .object({
    id: z.uuid(),
    from: z.object({ id: z.uuid(), name: z.string() }),
    caseCode: z.string(),
    reason: z.string(),
    severity: z.enum(RECALL_SEVERITIES),
    instructions: z.string().nullable(),
    startedAt: z.iso.datetime(),
    shipments: RecallNoticeDto.shape.shipments,
    /** Lots in your own records that came from the recalled shipments. */
    yourLots: z.array(
      z.object({
        lotId: z.uuid(),
        lotCode: z.string(),
        quantity: z.string(),
        uomCode: z.string(),
        status: z.string(),
      }),
    ),
    acknowledgedAt: z.iso.datetime().nullable(),
  })
  .openapi("IncomingRecallNotice");
