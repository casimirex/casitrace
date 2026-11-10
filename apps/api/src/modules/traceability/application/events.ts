import { can, KDE_SCHEMAS, kdeKey, type RecordEvent } from "@casitrace/contracts";
import { type Db, Prisma, type Tx } from "@casitrace/db";
import { AppError, type ErrorDetail, newId } from "@casitrace/shared";
import type { CommandContext } from "../../../platform/audit";
import { runCommand } from "../../../platform/command";
import { isUniqueViolation } from "../../../platform/dto";
import { eventShapeIssues, generateLotCode } from "../domain/event-rules";
import { checkMassBalance, type MassBalance } from "../domain/mass-balance";
import {
  ConversionError,
  convertSameDimension,
  D,
  type Decimal,
  fixed,
  isUom,
  toKg,
  type Uom,
} from "../domain/quantity";

export type Ctx = CommandContext & { orgId: string; role: string };

const fail = (message: string, details: ErrorDetail[] = []): never => {
  throw new AppError("VALIDATION_FAILED", message, details);
};

/** Stable JSON for request hashing (idempotency). */
const stable = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(stable).join(",")}]`
    : v && typeof v === "object"
      ? `{${Object.keys(v)
          .sort()
          .filter((k) => k !== "idempotencyKey")
          .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
          .join(",")}}`
      : JSON.stringify(v ?? null);
const requestHash = (e: RecordEvent) => new Bun.CryptoHasher("sha256").update(stable(e)).digest("hex");

interface LockedLot {
  id: string;
  lot_code: string;
  status: string;
  quantity: string;
  uom_code: string;
  product_version_id: string;
}

const conversionsFor = async (tx: Tx, versionIds: string[]) => {
  const rows = await tx.productUnitConversion.findMany({ where: { productVersionId: { in: versionIds } } });
  const map = new Map<string, { fromUom: string; toUom: string; factor: string }[]>();
  for (const r of rows) {
    const list = map.get(r.productVersionId) ?? [];
    list.push({ fromUom: r.fromUom, toUom: r.toUom, factor: r.factor.toString() });
    map.set(r.productVersionId, list);
  }
  return (id: string) => map.get(id) ?? [];
};

/** Converts a line quantity into the lot's unit (same dimension only). */
const inLotUnit = (q: string, from: string | undefined, lotUom: string, path: string): Decimal => {
  const qty = D(q);
  if (!from || from === lotUom) return qty;
  if (!isUom(from) || !isUom(lotUom)) return fail("Unknown unit.", [{ path, message: from }]);
  try {
    return convertSameDimension(qty, from, lotUom);
  } catch (e) {
    return fail("This quantity cannot be converted to the lot's unit.", [
      { path, message: (e as Error).message },
    ]);
  }
};

/**
 * Recomputes balance and status of lots from their non-voided event lines (the source of truth).
 */
export const recomputeLots = async (tx: Tx, lotIds: string[]) => {
  if (!lotIds.length) return;
  const rows = await tx.$queryRaw<
    { lot_id: string; balance: string; last_input_type: string | null; creator_voided: boolean }[]
  >`
    SELECT l.id AS lot_id,
           COALESCE(SUM(CASE ln.role WHEN 'output' THEN ln.quantity WHEN 'input' THEN -ln.quantity ELSE ln.quantity END)
                    FILTER (WHERE ln.id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM trace_event v WHERE v.voids_event_id = ln.event_id)), 0)::text AS balance,
           (SELECT e.type FROM trace_event_line i JOIN trace_event e ON e.id = i.event_id
             WHERE i.lot_id = l.id AND i.role = 'input'
               AND NOT EXISTS (SELECT 1 FROM trace_event v WHERE v.voids_event_id = e.id)
             ORDER BY e.occurred_at DESC, e.recorded_at DESC LIMIT 1) AS last_input_type,
           EXISTS (SELECT 1 FROM trace_event v WHERE v.voids_event_id = l.created_by_event_id) AS creator_voided
    FROM lot l
    LEFT JOIN trace_event_line ln ON ln.lot_id = l.id
    WHERE l.id = ANY(${lotIds}::uuid[])
    GROUP BY l.id`;
  for (const r of rows) {
    const balance = D(r.balance);
    if (balance.isNegative())
      fail("This would take a lot below zero.", [{ path: "quantity", message: r.lot_id }]);
    const current = await tx.lot.findUniqueOrThrow({ where: { id: r.lot_id }, select: { status: true } });
    let status: string;
    if (r.creator_voided) status = "voided";
    else if (balance.isZero()) status = r.last_input_type === "SHIP" ? "shipped" : "consumed";
    else status = current.status === "on_hold" || current.status === "recalled" ? current.status : "active";
    await tx.lot.update({ where: { id: r.lot_id }, data: { quantity: fixed(balance), status } });
  }
};

/** Records one event inside the caller's transaction. Returns its ID and whether it was a replay. */
export const recordEventTx = async (
  tx: Tx,
  ctx: Ctx,
  input: RecordEvent,
): Promise<{ eventId: string; replayed: boolean }> => {
  const hash = requestHash(input);
  if (input.idempotencyKey) {
    const existing = await tx.traceEvent.findFirst({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) {
      if (existing.requestHash !== hash)
        throw new AppError("CONFLICT", "This idempotency key was already used for a different event.");
      return { eventId: existing.id, replayed: true };
    }
  }

  const now = new Date();
  const issues = eventShapeIssues(input, now);
  const key = kdeKey(input.type, input.process);
  const { schema, version: kdeSchema } = KDE_SCHEMAS[key];
  const kdes = schema.safeParse(input.kdes);
  if (!kdes.success)
    issues.push(
      ...kdes.error.issues.map((i) => ({ path: ["kdes", ...i.path].join("."), message: i.message })),
    );
  if (issues.length) fail("The event is invalid.", issues);

  // References: location and trading partner must belong to this organisation (RLS).
  if (input.locationId) {
    const loc = await tx.location.findUnique({ where: { id: input.locationId } });
    if (!loc || loc.archivedAt) fail("Location not found.", [{ path: "locationId", message: "not found" }]);
    if (input.process === "harvest" && loc && !["plot", "farm"].includes(loc.type)) {
      fail("A harvest happens on a plot or farm.", [{ path: "locationId", message: `is a ${loc.type}` }]);
    }
  }
  if (input.partnerId) {
    const p = await tx.tradingPartner.findUnique({ where: { id: input.partnerId } });
    if (!p || p.archivedAt) fail("Trading partner not found.", [{ path: "partnerId", message: "not found" }]);
    if (input.type === "RECEIVE" && p && p.kind === "customer")
      fail("That partner is a customer, not a supplier.", [{ path: "partnerId", message: "customer" }]);
    if (input.type === "SHIP" && p && p.kind === "supplier")
      fail("That partner is a supplier, not a customer.", [{ path: "partnerId", message: "supplier" }]);
  }

  // Inputs: lock the lots (prevents two events consuming the same stock), check status and balance.
  const inputIds =
    input.type === "ADJUST" && input.adjust ? [input.adjust.lotId] : input.inputs.map((i) => i.lotId);
  const locked = inputIds.length
    ? await tx.$queryRaw<LockedLot[]>`
        SELECT id, lot_code, status, quantity::text AS quantity, uom_code, product_version_id
        FROM lot WHERE id = ANY(${inputIds}::uuid[]) ORDER BY id FOR UPDATE`
    : [];
  const lots = new Map(locked.map((l) => [l.id, l]));
  const inputQty: { lotId: string; qty: Decimal; uom: string; versionId: string }[] = [];
  for (const [i, line] of input.inputs.entries()) {
    const path = `inputs.${i}`;
    const lot = lots.get(line.lotId);
    if (!lot) fail("Input lot not found.", [{ path, message: "not found" }]);
    if (!lot) continue;
    if (lot.status !== "active")
      fail(`Lot ${lot.lot_code} is ${lot.status.replace("_", " ")} and cannot be used.`, [
        { path, message: lot.status },
      ]);
    const qty = inLotUnit(line.quantity, line.uomCode, lot.uom_code, `${path}.quantity`);
    if (qty.gt(D(lot.quantity))) {
      fail(`Lot ${lot.lot_code} has only ${fixed(D(lot.quantity))} ${lot.uom_code}.`, [
        { path: `${path}.quantity`, message: "more than available" },
      ]);
    }
    inputQty.push({ lotId: lot.id, qty, uom: lot.uom_code, versionId: lot.product_version_id });
  }
  if (input.adjust) {
    const lot = lots.get(input.adjust.lotId);
    if (!lot) fail("Lot not found.", [{ path: "adjust.lotId", message: "not found" }]);
    if (lot && lot.status === "voided") fail("A voided lot cannot be adjusted.");
  }

  // Outputs: products (current version), units, lot codes.
  const productIds = [...new Set(input.outputs.map((o) => o.productId))];
  const products = new Map(
    (await tx.product.findMany({ where: { id: { in: productIds } } })).map((p) => [p.id, p]),
  );
  const versions = new Map(
    (
      await tx.productVersion.findMany({
        where: { OR: [...products.values()].map((p) => ({ productId: p.id, version: p.currentVersion })) },
      })
    ).map((v) => [v.productId, v]),
  );
  const outputs: {
    lotId: string;
    productId: string;
    versionId: string;
    lotCode: string;
    qty: Decimal;
    uom: string;
    locationId: string | null;
  }[] = [];
  for (const [i, o] of input.outputs.entries()) {
    const path = `outputs.${i}`;
    const p = products.get(o.productId);
    const v = versions.get(o.productId);
    if (!p || !v) fail("Product not found.", [{ path: `${path}.productId`, message: "not found" }]);
    if (p?.archivedAt)
      fail(`Product ${p.sku} is archived.`, [{ path: `${path}.productId`, message: "archived" }]);
    if (!p || !v) continue;
    if (o.locationId && !(await tx.location.count({ where: { id: o.locationId } }))) {
      fail("Output location not found.", [{ path: `${path}.locationId`, message: "not found" }]);
    }
    const lotCode = o.lotCode ?? generateLotCode(p.sku, new Date(input.occurredAt));
    if (outputs.some((x) => x.productId === p.id && x.lotCode === lotCode))
      fail("Two outputs have the same lot code.", [{ path: `${path}.lotCode`, message: "duplicate" }]);
    outputs.push({
      lotId: newId(),
      productId: p.id,
      versionId: v.id,
      lotCode,
      qty: inLotUnit(o.quantity, o.uomCode, v.uomCode, `${path}.quantity`),
      uom: v.uomCode,
      locationId: o.locationId ?? input.locationId ?? null,
    });
  }

  // Mass balance for transformations.
  let massBalance: MassBalance | null = null;
  let overrideReason: string | null = null;
  if (input.type === "TRANSFORM") {
    const conv = await conversionsFor(tx, [
      ...inputQty.map((i) => i.versionId),
      ...outputs.map((o) => o.versionId),
    ]);
    try {
      massBalance = checkMassBalance(
        inputQty.map((i) => toKg(i.qty, i.uom as Uom, conv(i.versionId))),
        outputs.map((o) => toKg(o.qty, o.uom as Uom, conv(o.versionId))),
      );
    } catch (e) {
      if (!(e instanceof ConversionError)) throw e;
      fail(`Mass balance cannot be checked: ${e.message}. Add the conversion to the product.`, [
        { path: "outputs", message: "missing conversion" },
      ]);
    }
    if (massBalance && !massBalance.ok) {
      if (!input.overrideMassBalance) {
        throw new AppError(
          "VALIDATION_FAILED",
          `Outputs (${massBalance.outputKg} kg) exceed inputs (${massBalance.inputKg} kg) beyond the ${Number(massBalance.tolerance) * 100} % tolerance.`,
          [{ path: "outputs", message: "mass balance" }],
        );
      }
      if (!can(ctx.role, "event:override"))
        throw new AppError(
          "FORBIDDEN",
          "Only owners and admins can accept an event that fails mass balance.",
        );
      overrideReason = input.overrideMassBalance.reason;
    }
  }

  // Write: event, lines, lots, genealogy.
  const eventId = newId();
  try {
    await tx.traceEvent.create({
      data: {
        id: eventId,
        orgId: ctx.orgId,
        type: input.type,
        process: input.process ?? null,
        occurredAt: new Date(input.occurredAt),
        locationId: input.locationId ?? null,
        partnerId: input.partnerId ?? null,
        kdes: (kdes.success ? kdes.data : {}) as Prisma.InputJsonValue,
        kdeSchema,
        note: input.note ?? null,
        overrideReason,
        massBalance: massBalance ? (massBalance as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        idempotencyKey: input.idempotencyKey ?? null,
        requestHash: hash,
        actorId: ctx.actor.id,
      },
    });
  } catch (e) {
    if (isUniqueViolation(e))
      throw new AppError("CONFLICT", "This event was already recorded (same idempotency key).");
    throw e;
  }
  for (const o of outputs) {
    try {
      await tx.lot.create({
        data: {
          id: o.lotId,
          orgId: ctx.orgId,
          productId: o.productId,
          productVersionId: o.versionId,
          lotCode: o.lotCode,
          uomCode: o.uom,
          quantity: "0",
          initialQuantity: fixed(o.qty),
          locationId: o.locationId,
          createdByEventId: eventId,
        },
      });
    } catch (e) {
      if (isUniqueViolation(e))
        throw new AppError("CONFLICT", `Lot code ${o.lotCode} is already used for this product.`, [
          { path: "outputs", message: o.lotCode },
        ]);
      throw e;
    }
  }
  const lines = [
    ...inputQty.map((i) => ({ lotId: i.lotId, role: "input", quantity: fixed(i.qty), uomCode: i.uom })),
    ...outputs.map((o) => ({ lotId: o.lotId, role: "output", quantity: fixed(o.qty), uomCode: o.uom })),
    ...(input.adjust
      ? [
          {
            lotId: input.adjust.lotId,
            role: "adjust",
            quantity: fixed(D(input.adjust.delta)),
            uomCode: lots.get(input.adjust.lotId)?.uom_code ?? "kg",
          },
        ]
      : []),
  ];
  await tx.traceEventLine.createMany({
    data: lines.map((l) => ({ id: newId(), orgId: ctx.orgId, eventId, ...l })),
  });
  if (input.type === "TRANSFORM") {
    await tx.lotEdge.createMany({
      data: inputQty.flatMap((i) =>
        outputs.map((o) => ({
          id: newId(),
          orgId: ctx.orgId,
          parentLotId: i.lotId,
          childLotId: o.lotId,
          eventId,
        })),
      ),
    });
  }
  await recomputeLots(tx, [...new Set(lines.map((l) => l.lotId))]);
  return { eventId, replayed: false };
};

/** Records an event with its audit entry and outbox event. */
export const recordEvent = (db: Db, ctx: Ctx, input: RecordEvent) =>
  runCommand(db, ctx, async (tx) => {
    const { eventId, replayed } = await recordEventTx(tx, ctx, input);
    return {
      result: { eventId, replayed },
      audit: [
        replayed
          ? { action: "trace.event_replayed", resourceType: "event", resourceId: eventId }
          : {
              action: "trace.event_recorded",
              resourceType: "event",
              resourceId: eventId,
              data: { type: input.type, process: input.process ?? null },
            },
      ],
      events: replayed
        ? []
        : [
            {
              type: "trace.event_recorded",
              aggregateType: "event",
              aggregateId: eventId,
              payload: { type: input.type },
            },
          ],
    };
  });

/**
 * Voids an event (ADR 0007): appends a VOID event, recomputes affected lots, and optionally records a
 * corrected replacement in the same transaction. Refused while later events depend on its output lots.
 */
export const voidEvent = (db: Db, ctx: Ctx, eventId: string, reason: string, replacement?: RecordEvent) =>
  runCommand(db, ctx, async (tx) => {
    const target = await tx.traceEvent.findUnique({ where: { id: eventId }, include: { lines: true } });
    if (!target) throw new AppError("NOT_FOUND", "Event not found.");
    if (target.type === "VOID")
      throw new AppError("CONFLICT", "A void cannot be voided. Record the event again instead.");
    if (await tx.traceEvent.count({ where: { voidsEventId: eventId } }))
      throw new AppError("CONFLICT", "This event is already voided.");

    const outputLots = target.lines.filter((l) => l.role === "output").map((l) => l.lotId);
    if (outputLots.length) {
      const dependents = await tx.$queryRaw<{ id: string; type: string }[]>`
        SELECT DISTINCT e.id, e.type FROM trace_event_line ln JOIN trace_event e ON e.id = ln.event_id
        WHERE ln.lot_id = ANY(${outputLots}::uuid[]) AND e.id <> ${eventId}::uuid
          AND NOT EXISTS (SELECT 1 FROM trace_event v WHERE v.voids_event_id = e.id)`;
      if (dependents.length) {
        throw new AppError(
          "CONFLICT",
          `Later events use lots created by this event. Void them first (newest first): ${dependents.map((d) => `${d.type} ${d.id}`).join(", ")}.`,
        );
      }
    }
    const voidId = newId();
    try {
      await tx.traceEvent.create({
        data: {
          id: voidId,
          orgId: ctx.orgId,
          type: "VOID",
          occurredAt: new Date(),
          kdes: {},
          kdeSchema: KDE_SCHEMAS.VOID.version,
          note: reason,
          voidsEventId: eventId,
          actorId: ctx.actor.id,
        },
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new AppError("CONFLICT", "This event is already voided.");
      throw e;
    }
    await recomputeLots(tx, [...new Set(target.lines.map((l) => l.lotId))]);
    const replaced = replacement ? await recordEventTx(tx, ctx, replacement) : null;
    return {
      result: { voidEventId: voidId, replacementEventId: replaced?.eventId ?? null },
      audit: [
        {
          action: "trace.event_voided",
          resourceType: "event",
          resourceId: eventId,
          data: { reason, voidEventId: voidId },
        },
        ...(replaced
          ? [
              {
                action: "trace.event_recorded",
                resourceType: "event",
                resourceId: replaced.eventId,
                data: { replaces: eventId },
              },
            ]
          : []),
      ],
      events: [
        {
          type: "trace.event_voided",
          aggregateType: "event",
          aggregateId: eventId,
          payload: { voidEventId: voidId },
        },
      ],
    };
  });

export const setHold = (db: Db, ctx: Ctx, lotId: string, hold: boolean, reason?: string) =>
  runCommand(db, ctx, async (tx) => {
    const lot = await tx.lot.findUnique({ where: { id: lotId } });
    if (!lot) throw new AppError("NOT_FOUND", "Lot not found.");
    if (hold) {
      if (lot.status !== "active")
        throw new AppError("CONFLICT", `Only active lots can be put on hold (this one is ${lot.status}).`);
      if (!reason?.trim()) fail("Say why the lot is on hold.", [{ path: "reason", message: "required" }]);
      await tx.lot.update({ where: { id: lotId }, data: { status: "on_hold", holdReason: reason ?? null } });
    } else {
      if (lot.status !== "on_hold") throw new AppError("CONFLICT", "The lot is not on hold.");
      await tx.lot.update({ where: { id: lotId }, data: { status: "active", holdReason: null } });
      await recomputeLots(tx, [lotId]);
    }
    return {
      result: { ok: true },
      audit: [
        {
          action: hold ? "lot.held" : "lot.released",
          resourceType: "lot",
          resourceId: lotId,
          data: { reason: reason ?? null },
        },
      ],
    };
  });
