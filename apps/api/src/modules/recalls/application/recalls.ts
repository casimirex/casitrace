import type { IncomingRecallNotice, RecallDto, StartRecall } from "@casitrace/contracts";
import type { Db, Prisma, Tx } from "@casitrace/db";
import { AppError, newId } from "@casitrace/shared";
import type { z } from "zod";
import type { CommandContext } from "../../../platform/audit";
import { runCommand } from "../../../platform/command";
import { notifyOrg } from "../../../platform/notify";
import { withTenant } from "../../../platform/tenant";
import { traceAcross } from "../../exchange/application/cross-trace";
import { orgIdentities } from "../../exchange/application/orgs";
import { csvCell } from "../../traceability/application/queries";
import { D, fixed } from "../../traceability/domain/quantity";

type Ctx = CommandContext & { orgId: string };
type RecallOut = z.infer<typeof RecallDto>;
type Impact = NonNullable<RecallOut["impact"]>;
type Shipment = RecallOut["notices"][number]["shipments"][number];
const SEVERITY_LABEL: Record<string, string> = {
  health_risk: "health risk",
  quality: "quality",
  regulatory: "regulatory",
  other: "other",
};

/**
 * The impact of a recall (roadmap-v2 P8): everything downstream of the starting lots, across
 * organisations where they share (redacted otherwise), and every customer that received affected
 * product from this organisation.
 */
const computeImpact = async (db: Db, orgId: string, lotIds: string[]) => {
  const lots = new Map<string, Impact["lots"][number]>();
  let truncated = false;
  const shipments: {
    lotId: string;
    partnerId: string | null;
    quantity: string;
    uomCode: string;
    occurredAt: string;
  }[] = [];
  for (const root of lotIds) {
    const t = await traceAcross(db, { orgId, actorId: null }, root, "forward", 50);
    truncated ||= t.truncated;
    for (const n of t.nodes) {
      if (lots.has(n.lotId)) continue;
      lots.set(n.lotId, {
        lotId: n.lotId,
        lotCode: n.lotCode,
        productName: n.productName,
        org: { id: n.org.id, name: n.org.name },
        depth: n.depth,
        quantity: n.quantity,
        uomCode: n.uomCode,
        status: n.status,
        redacted: n.redacted,
      });
    }
    // Direct customers: this organisation's own shipments of affected lots.
    const own = new Set(t.nodes.filter((n) => n.org.id === orgId).map((n) => n.lotId));
    shipments.push(
      ...t.shipments.filter((s) => own.has(s.lotId)).map((s) => ({ ...s, partnerId: s.partnerId })),
    );
  }
  return { lots: [...lots.values()].sort((a, b) => a.depth - b.depth), shipments, truncated };
};

const nextCode = async (tx: Tx, mode: "real" | "drill") => {
  const year = new Date().getUTCFullYear();
  const prefix = `${mode === "drill" ? "DRILL" : "RC"}-${year}-`;
  const count = await tx.recallCase.count({ where: { code: { startsWith: prefix } } });
  return `${prefix}${String(count + 1).padStart(3, "0")}`;
};

export const startRecall = async (
  db: Db,
  ctx: Ctx,
  input: z.infer<typeof StartRecall>,
  webOrigin: string,
) => {
  // Validate the starting lots in this organisation.
  await withTenant(db, ctx.orgId, async (tx) => {
    const found = await tx.lot.findMany({
      where: { id: { in: input.lotIds } },
      select: { id: true, status: true },
    });
    if (found.length !== new Set(input.lotIds).size)
      throw new AppError("VALIDATION_FAILED", "A lot was not found.", [
        { path: "lotIds", message: "not found" },
      ]);
    if (found.some((l) => l.status === "voided"))
      throw new AppError("VALIDATION_FAILED", "A voided lot cannot be recalled.");
  });
  const impact = await computeImpact(db, ctx.orgId, input.lotIds);
  const real = input.mode === "real";

  const caseId = newId();
  const result = await runCommand(
    db,
    ctx,
    async (tx) => {
      const code = await nextCode(tx, input.mode);
      const ownLots = impact.lots.filter((l) => l.org.id === ctx.orgId && !l.redacted);
      const locations = await tx.lot.findMany({
        where: { id: { in: ownLots.map((l) => l.lotId) } },
        select: { locationId: true },
      });
      const locNames = (
        await tx.location.findMany({
          where: { id: { in: locations.map((l) => l.locationId).filter((x): x is string => !!x) } },
          select: { code: true, name: true },
        })
      ).map((l) => `${l.code} · ${l.name}`);
      const summary: Impact = {
        lots: impact.lots,
        ownLotsFlagged: real ? ownLots.length : 0,
        customers: 0,
        locations: [...new Set(locNames)],
        redactedOrganisations: [...new Set(impact.lots.filter((l) => l.redacted).map((l) => l.org.name))],
        truncated: impact.truncated,
      };
      await tx.recallCase.create({
        data: {
          id: caseId,
          orgId: ctx.orgId,
          code,
          mode: input.mode,
          reason: input.reason,
          severity: input.severity,
          instructions: input.instructions ?? null,
          startedById: ctx.actor.id,
          impactAt: new Date(),
        },
      });
      await tx.recallLot.createMany({
        data: ownLots.map((l) => ({
          id: newId(),
          orgId: ctx.orgId,
          caseId,
          lotId: l.lotId,
          role: input.lotIds.includes(l.lotId) ? "root" : "downstream",
          depth: l.depth,
        })),
      });
      if (real)
        await tx.lot.updateMany({
          where: { id: { in: ownLots.map((l) => l.lotId) }, recallCaseId: null },
          data: { recallCaseId: caseId },
        });

      // One notice per customer that received affected product.
      const byPartner = new Map<string, Shipment[]>();
      const lotCode = new Map(impact.lots.map((l) => [l.lotId, l.lotCode]));
      for (const s of impact.shipments) {
        if (!s.partnerId) continue;
        const list = byPartner.get(s.partnerId) ?? [];
        list.push({
          lotCode: lotCode.get(s.lotId) ?? "",
          quantity: s.quantity,
          uomCode: s.uomCode,
          shippedAt: s.occurredAt,
        });
        byPartner.set(s.partnerId, list);
      }
      const partners = await tx.tradingPartner.findMany({ where: { id: { in: [...byPartner.keys()] } } });
      const sender = (await orgIdentities(tx, [ctx.orgId])).get(ctx.orgId)?.name ?? "A supplier";
      for (const p of partners) {
        const platform = !!p.linkedOrgId;
        await tx.recallNotice.create({
          data: {
            id: newId(),
            orgId: ctx.orgId,
            caseId,
            partnerId: p.id,
            // A drill never reaches other organisations: notices are kept internal.
            recipientOrgId: platform && real ? p.linkedOrgId : null,
            channel: platform && real ? "platform" : "external",
            shipments: (byPartner.get(p.id) ?? []) as unknown as Prisma.InputJsonValue,
            notifiedAt: platform && real ? new Date() : null,
          },
        });
        if (platform && real && p.linkedOrgId) {
          await notifyOrg(
            tx,
            p.linkedOrgId,
            "recall:acknowledge",
            {
              kind: "recall.notice",
              title: `Recall from ${sender}: ${code}`,
              body: `${sender} is recalling product you received (${SEVERITY_LABEL[input.severity]}). ${input.reason}${input.instructions ? ` Instructions: ${input.instructions}` : ""}`,
              link: `/orgs/${p.linkedOrgId}/recalls`,
              dedupeKey: `recall:${caseId}`,
            },
            webOrigin,
          );
        }
      }
      summary.customers = partners.length;
      await tx.recallCase.update({
        where: { id: caseId },
        data: { impact: summary as unknown as Prisma.InputJsonValue },
      });
      // The team is told in both modes; drills are labelled so nobody mistakes one for a real recall.
      await notifyOrg(
        tx,
        ctx.orgId,
        "recall:drill",
        {
          kind: real ? "recall.started" : "recall.drill",
          title: real ? `Recall ${code} started` : `Mock recall ${code} (drill)`,
          body: `${summary.lots.length} lots affected, ${summary.customers} customers. ${input.reason}`,
          link: `/orgs/${ctx.orgId}/recalls/${caseId}`,
          dedupeKey: `recall-team:${caseId}`,
        },
        webOrigin,
      );
      return {
        result: { id: caseId },
        audit: [
          {
            action: real ? "recall.started" : "recall.drill_started",
            resourceType: "recall",
            resourceId: caseId,
            data: { code, lots: summary.lots.length, customers: summary.customers },
          },
        ],
        events: [
          {
            type: real ? "recall.started" : "recall.drill_started",
            aggregateType: "recall",
            aggregateId: caseId,
            payload: { code },
          },
        ],
      };
    },
    { timeoutMs: 60_000 },
  );
  return getRecall(db, ctx.orgId, result.id);
};

export const getRecall = (db: Db, orgId: string, id: string) =>
  withTenant(db, orgId, async (tx): Promise<RecallOut> => {
    const c = await tx.recallCase.findUnique({ where: { id }, include: { notices: true } });
    if (!c) throw new AppError("NOT_FOUND", "Recall not found.");
    const partners = new Map(
      (await tx.tradingPartner.findMany({ where: { id: { in: c.notices.map((n) => n.partnerId) } } })).map(
        (p) => [p.id, p],
      ),
    );
    return {
      id: c.id,
      code: c.code,
      mode: c.mode as RecallOut["mode"],
      status: c.status as RecallOut["status"],
      reason: c.reason,
      severity: c.severity as RecallOut["severity"],
      instructions: c.instructions,
      startedAt: c.startedAt.toISOString(),
      impactAt: c.impactAt?.toISOString() ?? null,
      exportedAt: c.exportedAt?.toISOString() ?? null,
      closedAt: c.closedAt?.toISOString() ?? null,
      secondsToExport: c.exportedAt
        ? Math.round((c.exportedAt.getTime() - c.startedAt.getTime()) / 100) / 10
        : null,
      impact: (c.impact as Impact | null) ?? null,
      notices: c.notices.map((n) => {
        const p = partners.get(n.partnerId);
        return {
          id: n.id,
          partner: {
            id: n.partnerId,
            name: p?.name ?? "",
            email: p?.email ?? null,
            city: p?.city ?? null,
            countryCode: p?.countryCode ?? null,
          },
          channel: n.channel as "platform" | "external",
          shipments: n.shipments as unknown as Shipment[],
          notifiedAt: n.notifiedAt?.toISOString() ?? null,
          acknowledgedAt: n.acknowledgedAt?.toISOString() ?? null,
          ackNote: n.ackNote,
        };
      }),
    };
  });

export const listRecalls = (db: Db, orgId: string) =>
  withTenant(db, orgId, async (tx) =>
    (await tx.recallCase.findMany({ where: { orgId }, orderBy: { startedAt: "desc" }, take: 200 })).map(
      (c) => ({
        id: c.id,
        code: c.code,
        mode: c.mode as "real" | "drill",
        status: c.status as "open" | "closed",
        reason: c.reason,
        startedAt: c.startedAt.toISOString(),
        secondsToExport: c.exportedAt
          ? Math.round((c.exportedAt.getTime() - c.startedAt.getTime()) / 100) / 10
          : null,
      }),
    ),
  );

/**
 * CSV of the impact set and the customer contact list (for customers off Casitrace, who must be
 * called or emailed). The first export stops the drill clock.
 */
export const exportRecall = async (db: Db, ctx: Ctx, id: string) => {
  const r = await getRecall(db, ctx.orgId, id);
  await runCommand(db, ctx, async (tx) => {
    await tx.recallCase.updateMany({ where: { id, exportedAt: null }, data: { exportedAt: new Date() } });
    return { result: null, audit: [{ action: "recall.exported", resourceType: "recall", resourceId: id }] };
  });
  const rows = [
    `# ${r.mode === "drill" ? "MOCK RECALL (DRILL)" : "RECALL"} ${r.code} started ${r.startedAt}: ${r.reason}`,
    "section,organisation,lot_code,product,steps_downstream,quantity_now,uom,status,shared",
    ...(r.impact?.lots ?? []).map((l) =>
      [
        "lot",
        l.org.name,
        l.lotCode,
        l.productName,
        l.depth,
        l.quantity,
        l.uomCode,
        l.status,
        l.redacted ? "not shared" : "yes",
      ]
        .map(csvCell)
        .join(","),
    ),
    "",
    "section,customer,on_casitrace,email,city,country,lot_code,quantity,uom,shipped_at,acknowledged_at",
    ...r.notices.flatMap((n) =>
      n.shipments.map((s) =>
        [
          "customer",
          n.partner.name,
          n.channel === "platform" ? "yes" : "no",
          n.partner.email,
          n.partner.city,
          n.partner.countryCode,
          s.lotCode,
          s.quantity,
          s.uomCode,
          s.shippedAt,
          n.acknowledgedAt,
        ]
          .map(csvCell)
          .join(","),
      ),
    ),
  ];
  return { csv: `${rows.join("\n")}\n`, code: r.code };
};

/** The recalling organisation records that a customer (usually off Casitrace) confirmed the notice. */
export const recordAcknowledgement = (db: Db, ctx: Ctx, caseId: string, noticeId: string, note: string) =>
  runCommand(db, ctx, async (tx) => {
    const n = await tx.recallNotice.findFirst({ where: { id: noticeId, caseId, orgId: ctx.orgId } });
    if (!n) throw new AppError("NOT_FOUND", "Notice not found.");
    if (n.acknowledgedAt) throw new AppError("CONFLICT", "Already acknowledged.");
    await tx.recallNotice.update({
      where: { id: noticeId },
      data: { acknowledgedAt: new Date(), acknowledgedById: ctx.actor.id, ackNote: note },
    });
    return {
      result: { ok: true as const },
      audit: [
        {
          action: "recall.acknowledged",
          resourceType: "recall",
          resourceId: caseId,
          data: { noticeId, note },
        },
      ],
    };
  });

export const closeRecall = (db: Db, ctx: Ctx, id: string, note: string) =>
  runCommand(db, ctx, async (tx) => {
    const c = await tx.recallCase.findUnique({ where: { id } });
    if (!c) throw new AppError("NOT_FOUND", "Recall not found.");
    if (c.status === "closed") throw new AppError("CONFLICT", "Already closed.");
    // Recalled lots stay flagged: product that was recalled stays recalled on its public page.
    await tx.recallCase.update({
      where: { id },
      data: { status: "closed", closedAt: new Date(), closedById: ctx.actor.id, closeNote: note },
    });
    return {
      result: { ok: true as const },
      audit: [{ action: "recall.closed", resourceType: "recall", resourceId: id, data: { note } }],
    };
  });

// ─── the customer's side ────────────────────────────────────────────────────

/**
 * Recall notices addressed to this organisation, with the lots in its own records that came from
 * the recalled shipments (through cross-organisation links), so it can recall them in turn.
 */
export const incomingNotices = async (
  db: Db,
  orgId: string,
): Promise<z.infer<typeof IncomingRecallNotice>[]> => {
  const notices = await withTenant(db, orgId, (tx) =>
    tx.recallNotice.findMany({ where: { recipientOrgId: orgId }, orderBy: { notifiedAt: "desc" } }),
  );
  const out: z.infer<typeof IncomingRecallNotice>[] = [];
  for (const n of notices) {
    // Case details belong to the sender; read only these fields in its scope.
    const c = await withTenant(db, n.orgId, (tx) =>
      tx.recallCase.findUniqueOrThrow({
        where: { id: n.caseId },
        select: { code: true, reason: true, severity: true, instructions: true, startedAt: true },
      }),
    );
    const senderLots = await withTenant(db, n.orgId, (tx) =>
      tx.recallLot.findMany({ where: { caseId: n.caseId }, select: { lotId: true } }),
    );
    const yourLots = await withTenant(db, orgId, async (tx) => {
      const links = await tx.crossLotLink.findMany({
        where: {
          downstreamOrgId: orgId,
          upstreamOrgId: n.orgId,
          upstreamLotId: { in: senderLots.map((l) => l.lotId) },
        },
      });
      const lots = await tx.lot.findMany({ where: { id: { in: links.map((l) => l.downstreamLotId) } } });
      return lots.map((l) => ({
        lotId: l.id,
        lotCode: l.lotCode,
        quantity: fixed(D(l.quantity)),
        uomCode: l.uomCode,
        status: l.status,
      }));
    });
    const from = (await orgIdentities(db, [n.orgId])).get(n.orgId);
    out.push({
      id: n.id,
      from: { id: n.orgId, name: from?.name ?? "" },
      caseCode: c.code,
      reason: c.reason,
      severity: c.severity as z.infer<typeof IncomingRecallNotice>["severity"],
      instructions: c.instructions,
      startedAt: c.startedAt.toISOString(),
      shipments: n.shipments as unknown as Shipment[],
      yourLots,
      acknowledgedAt: n.acknowledgedAt?.toISOString() ?? null,
    });
  }
  return out;
};

export const acknowledgeIncoming = (db: Db, ctx: Ctx, noticeId: string, note: string, webOrigin: string) =>
  runCommand(db, ctx, async (tx) => {
    const n = await tx.recallNotice.findFirst({ where: { id: noticeId, recipientOrgId: ctx.orgId } });
    if (!n) throw new AppError("NOT_FOUND", "Notice not found.");
    if (n.acknowledgedAt) throw new AppError("CONFLICT", "Already acknowledged.");
    await tx.recallNotice.update({
      where: { id: noticeId },
      data: { acknowledgedAt: new Date(), acknowledgedById: ctx.actor.id, ackNote: note },
    });
    const me = (await orgIdentities(tx, [ctx.orgId])).get(ctx.orgId)?.name ?? "A customer";
    await notifyOrg(
      tx,
      n.orgId,
      "recall:drill",
      {
        kind: "recall.acknowledged",
        title: `${me} acknowledged the recall`,
        body: note,
        link: `/orgs/${n.orgId}/recalls/${n.caseId}`,
        dedupeKey: `recall-ack:${noticeId}`,
      },
      webOrigin,
    );
    return {
      result: { ok: true as const },
      audit: [
        {
          action: "recall.notice_acknowledged",
          resourceType: "recall_notice",
          resourceId: noticeId,
          data: { note },
        },
      ],
    };
  });
