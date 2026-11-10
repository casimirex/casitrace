import type { AcceptHandoff, HandoffDto } from "@casitrace/contracts";
import type { Db, Prisma, Tx } from "@casitrace/db";
import { AppError, newId } from "@casitrace/shared";
import type { z } from "zod";
import { runCommand } from "../../../platform/command";
import { withTenant } from "../../../platform/tenant";
import { type Ctx, recordEventTx } from "../../traceability/application/events";
import { convertSameDimension, D, fixed, isUom } from "../../traceability/domain/quantity";
import { createLotGrantTx } from "./grants";
import { orgIdentities } from "./orgs";

type HandoffOut = z.infer<typeof HandoffDto>;
type Line = HandoffOut["lines"][number];

/**
 * Called inside the sender's SHIP transaction when the customer is a Casitrace organisation:
 * creates the pending handoff (a snapshot of what was shipped) and, if asked, grants the receiver
 * visibility of the shipped lots' history.
 */
export const createHandoffForShipTx = async (
  tx: Tx,
  ctx: Ctx,
  shipEventId: string,
  receiverOrgId: string,
  shippedAt: Date,
  share: { upstreamDepth: number; includeKdes: boolean; includeEvidence: boolean } | undefined,
) => {
  const lines = await tx.traceEventLine.findMany({ where: { eventId: shipEventId, role: "input" } });
  const lots = await tx.lot.findMany({ where: { id: { in: lines.map((l) => l.lotId) } } });
  const versions = new Map(
    (await tx.productVersion.findMany({ where: { id: { in: lots.map((l) => l.productVersionId) } } })).map(
      (v) => [v.id, v],
    ),
  );
  const products = new Map(
    (await tx.product.findMany({ where: { id: { in: lots.map((l) => l.productId) } } })).map((p) => [
      p.id,
      p,
    ]),
  );
  const snapshot: Line[] = lines.map((ln) => {
    const lot = lots.find((l) => l.id === ln.lotId);
    const v = lot ? versions.get(lot.productVersionId) : undefined;
    return {
      senderLotId: ln.lotId,
      lotCode: lot?.lotCode ?? "",
      productSku: lot ? (products.get(lot.productId)?.sku ?? "") : "",
      productName: v?.name ?? "",
      gtin: v?.gtin ?? null,
      category: v?.category ?? "other",
      quantity: fixed(D(ln.quantity)),
      uomCode: ln.uomCode,
    };
  });
  await tx.handoff.create({
    data: {
      id: newId(),
      senderOrgId: ctx.orgId,
      receiverOrgId,
      shipEventId,
      lines: snapshot as unknown as Prisma.InputJsonValue,
      shippedAt,
    },
  });
  if (share) {
    for (const l of snapshot) {
      await createLotGrantTx(tx, ctx, {
        granteeOrgId: receiverOrgId,
        lotId: l.senderLotId,
        upstreamDepth: share.upstreamDepth,
        downstreamDepth: 0,
        includeKdes: share.includeKdes,
        includeEvidence: share.includeEvidence,
        note: "Shared with the shipment",
      });
    }
  }
};

/** A shipment with a handoff can be voided only before the receiver accepts it. */
export const onShipVoidedTx = async (tx: Tx, shipEventId: string) => {
  const h = await tx.handoff.findUnique({ where: { shipEventId } });
  if (!h) return;
  if (h.status === "accepted") {
    throw new AppError(
      "CONFLICT",
      "The receiver already booked this shipment in. Ask them to void their receipt first.",
    );
  }
  await tx.handoff.update({ where: { id: h.id }, data: { status: "cancelled", decidedAt: new Date() } });
};

const toDto = async (
  db: Db,
  orgId: string,
  rows: Awaited<ReturnType<Tx["handoff"]["findMany"]>>,
): Promise<HandoffOut[]> => {
  const orgs = await orgIdentities(
    db,
    rows.flatMap((h) => [h.senderOrgId, h.receiverOrgId]),
  );
  const out: HandoffOut[] = [];
  for (const h of rows) {
    const incoming = h.receiverOrgId === orgId;
    const other = orgs.get(incoming ? h.senderOrgId : h.receiverOrgId);
    const links = await withTenant(db, orgId, (tx) =>
      tx.crossLotLink.findMany({ where: { handoffId: h.id } }),
    );
    // Lot codes on our side: received lots (incoming) are ours; for outgoing, the receiver's lot codes stay private.
    const ourLots = incoming
      ? new Map(
          (
            await withTenant(db, orgId, (tx) =>
              tx.lot.findMany({ where: { id: { in: links.map((l) => l.downstreamLotId) } } }),
            )
          ).map((l) => [l.id, l]),
        )
      : new Map();
    const shipEvent = !incoming
      ? await withTenant(db, orgId, (tx) => tx.traceEvent.findUnique({ where: { id: h.shipEventId } }))
      : null;
    const sharedHistory =
      (await withTenant(db, h.senderOrgId, (tx) =>
        tx.sharingGrant.count({
          where: {
            kind: "lot",
            revokedAt: null,
            lotId: { in: (h.lines as unknown as Line[]).map((l) => l.senderLotId) },
            OR: [{ granteeOrgId: h.receiverOrgId }, { granteeOrgId: null }],
          },
        }),
      )) > 0;
    out.push({
      id: h.id,
      direction: incoming ? "incoming" : "outgoing",
      status: h.status as HandoffOut["status"],
      counterparty: { id: other?.id ?? "", name: other?.name ?? "", verified: other?.verified ?? false },
      shippedAt: h.shippedAt.toISOString(),
      lines: h.lines as unknown as Line[],
      shipmentRef: ((shipEvent?.kdes as { shipmentRef?: string } | null)?.shipmentRef ?? null) as
        | string
        | null,
      disputeReason: h.disputeReason,
      decidedAt: h.decidedAt?.toISOString() ?? null,
      receivedLots: incoming
        ? links.map((l) => ({
            senderLotId: l.upstreamLotId,
            lotId: l.downstreamLotId,
            lotCode: ourLots.get(l.downstreamLotId)?.lotCode ?? "",
          }))
        : [],
      sharedHistory,
    });
  }
  return out;
};

export const listHandoffs = async (
  db: Db,
  orgId: string,
  opts: { direction?: "incoming" | "outgoing"; status?: string },
) => {
  const rows = await withTenant(db, orgId, (tx) =>
    tx.handoff.findMany({
      where: {
        ...(opts.direction === "incoming"
          ? { receiverOrgId: orgId }
          : opts.direction === "outgoing"
            ? { senderOrgId: orgId }
            : {}),
        ...(opts.status ? { status: opts.status } : {}),
      },
      orderBy: { shippedAt: "desc" },
      take: 200,
    }),
  );
  return toDto(db, orgId, rows);
};

export const getHandoff = async (db: Db, orgId: string, id: string) => {
  const h = await withTenant(db, orgId, (tx) => tx.handoff.findUnique({ where: { id } }));
  if (!h) throw new AppError("NOT_FOUND", "Shipment not found.");
  const [dto] = await toDto(db, orgId, [h]);
  return dto as HandoffOut;
};

/**
 * The receiver books an incoming shipment in: one RECEIVE event in its own records, with a new lot
 * per shipped lot, linked across organisations to the sender's lot.
 */
export const acceptHandoff = async (db: Db, ctx: Ctx, id: string, body: z.infer<typeof AcceptHandoff>) => {
  const receiverOrgId = ctx.orgId;
  const result = await runCommand(db, ctx, async (tx) => {
    const h = await tx.handoff.findUnique({ where: { id } });
    if (!h || h.receiverOrgId !== receiverOrgId) throw new AppError("NOT_FOUND", "Shipment not found.");
    if (h.status !== "pending" && h.status !== "disputed")
      throw new AppError("CONFLICT", `This shipment is ${h.status}.`);
    const lines = h.lines as unknown as Line[];
    const byLot = new Map(body.lines.map((l) => [l.senderLotId, l]));
    if (lines.some((l) => !byLot.has(l.senderLotId)) || body.lines.length !== lines.length) {
      throw new AppError("VALIDATION_FAILED", "Map every shipped lot to one of your products.", [
        { path: "lines", message: "incomplete" },
      ]);
    }

    // Our partner record for the sender (created when it does not exist yet).
    const senderName = (await orgIdentities(tx, [h.senderOrgId])).get(h.senderOrgId)?.name ?? "Supplier";
    let partner = await tx.tradingPartner.findFirst({ where: { linkedOrgId: h.senderOrgId } });
    if (!partner) {
      partner = await tx.tradingPartner.create({
        data: {
          id: newId(),
          orgId: receiverOrgId,
          name: senderName,
          kind: "supplier",
          linkedOrgId: h.senderOrgId,
          notes: "Added when accepting a shipment",
        },
      });
    } else if (partner.kind === "customer") {
      partner = await tx.tradingPartner.update({ where: { id: partner.id }, data: { kind: "both" } });
    }

    // Quantities in the receiver's product units.
    const products = await tx.product.findMany({ where: { id: { in: body.lines.map((l) => l.productId) } } });
    const versions = await tx.productVersion.findMany({
      where: { OR: products.map((p) => ({ productId: p.id, version: p.currentVersion })) },
    });
    const outputs = lines.map((l, i) => {
      const m = byLot.get(l.senderLotId) as (typeof body.lines)[number];
      const product = products.find((p) => p.id === m.productId);
      const v = versions.find((x) => x.productId === m.productId);
      if (!product || !v)
        throw new AppError("VALIDATION_FAILED", "Product not found.", [
          { path: `lines.${i}.productId`, message: "not found" },
        ]);
      let quantity = m.quantity;
      if (!quantity) {
        if (!isUom(l.uomCode) || !isUom(v.uomCode)) throw new AppError("VALIDATION_FAILED", "Unknown unit.");
        try {
          quantity = fixed(convertSameDimension(D(l.quantity), l.uomCode, v.uomCode));
        } catch {
          throw new AppError(
            "VALIDATION_FAILED",
            `Shipped in ${l.uomCode}; your product is counted in ${v.uomCode}. Give the quantity received.`,
            [{ path: `lines.${i}.quantity`, message: "required" }],
          );
        }
      }
      return {
        productId: m.productId,
        quantity,
        ...(m.lotCode ? { lotCode: m.lotCode } : { lotCode: l.lotCode }),
        ...(m.locationId ? { locationId: m.locationId } : {}),
      };
    });

    const { eventId } = await recordEventTx(tx, ctx, {
      type: "RECEIVE",
      occurredAt: body.occurredAt ?? new Date().toISOString(),
      partnerId: partner.id,
      kdes: {
        supplierLotCode: lines
          .map((l) => l.lotCode)
          .join(", ")
          .slice(0, 60),
      },
      inputs: [],
      outputs,
      note: `Shipment from ${senderName} (handoff ${h.id})`,
    });
    const created = await tx.traceEventLine.findMany({ where: { eventId, role: "output" } });
    // Output lines are created in the same order as the outputs.
    await tx.crossLotLink.createMany({
      data: lines.map((l, i) => ({
        id: newId(),
        upstreamOrgId: h.senderOrgId,
        upstreamLotId: l.senderLotId,
        downstreamOrgId: receiverOrgId,
        downstreamLotId: (created[i] as (typeof created)[number]).lotId,
        handoffId: h.id,
      })),
    });
    await tx.handoff.update({
      where: { id },
      data: { status: "accepted", receiveEventId: eventId, decidedById: ctx.actor.id, decidedAt: new Date() },
    });
    return {
      result: { receiveEventId: eventId },
      audit: [
        {
          action: "handoff.accepted",
          resourceType: "handoff",
          resourceId: id,
          data: { receiveEventId: eventId },
        },
      ],
      events: [
        {
          type: "handoff.accepted",
          aggregateType: "handoff",
          aggregateId: id,
          payload: { senderOrgId: h.senderOrgId },
        },
      ],
    };
  });
  return { ...result, handoff: await getHandoff(db, receiverOrgId, id) };
};

export const disputeHandoff = (db: Db, ctx: Ctx, id: string, reason: string) =>
  runCommand(db, ctx, async (tx) => {
    const h = await tx.handoff.findUnique({ where: { id } });
    if (!h || h.receiverOrgId !== ctx.orgId) throw new AppError("NOT_FOUND", "Shipment not found.");
    if (h.status !== "pending") throw new AppError("CONFLICT", `This shipment is ${h.status}.`);
    await tx.handoff.update({
      where: { id },
      data: { status: "disputed", disputeReason: reason, decidedById: ctx.actor.id, decidedAt: new Date() },
    });
    return {
      result: { ok: true as const },
      audit: [{ action: "handoff.disputed", resourceType: "handoff", resourceId: id, data: { reason } }],
      events: [
        {
          type: "handoff.disputed",
          aggregateType: "handoff",
          aggregateId: id,
          payload: { senderOrgId: h.senderOrgId, reason },
        },
      ],
    };
  });
