import type { LotDto, TraceEventDto, TraceResult } from "@casitrace/contracts";
import type { Db, Prisma, Tx } from "@casitrace/db";
import { AppError } from "@casitrace/shared";
import type { z } from "zod";
import { withTenant } from "../../../platform/tenant";
import { D, fixed } from "../domain/quantity";

type LotOut = z.infer<typeof LotDto>;
type EventOut = z.infer<typeof TraceEventDto>;

const q = (v: { toString(): string }) => fixed(D(v));

const lotRefs = async (tx: Tx, lotIds: string[]) => {
  const lots = await tx.lot.findMany({ where: { id: { in: lotIds } } });
  const versions = new Map(
    (
      await tx.productVersion.findMany({
        where: { id: { in: [...new Set(lots.map((l) => l.productVersionId))] } },
      })
    ).map((v) => [v.id, v]),
  );
  const products = new Map(
    (await tx.product.findMany({ where: { id: { in: [...new Set(lots.map((l) => l.productId))] } } })).map(
      (p) => [p.id, p],
    ),
  );
  return new Map(
    lots.map((l) => {
      const v = versions.get(l.productVersionId);
      return [
        l.id,
        {
          lot: l,
          ref: {
            id: l.id,
            lotCode: l.lotCode,
            productId: l.productId,
            productSku: products.get(l.productId)?.sku ?? "",
            productName: v?.name ?? "",
            productVersion: v?.version ?? 0,
          },
          version: v,
        },
      ];
    }),
  );
};

const locationsById = async (tx: Tx, ids: (string | null)[]) =>
  new Map(
    (
      await tx.location.findMany({
        where: { id: { in: ids.filter((x): x is string => !!x) } },
        select: { id: true, code: true, name: true },
      })
    ).map((l) => [l.id, l]),
  );
const partnersById = async (tx: Tx, ids: (string | null)[]) =>
  new Map(
    (
      await tx.tradingPartner.findMany({
        where: { id: { in: ids.filter((x): x is string => !!x) } },
        select: { id: true, name: true },
      })
    ).map((p) => [p.id, p]),
  );

type EventRow = Prisma.TraceEventGetPayload<{ include: { lines: true } }>;

export const eventDtos = async (tx: Tx, events: EventRow[]): Promise<EventOut[]> => {
  const refs = await lotRefs(tx, [...new Set(events.flatMap((e) => e.lines.map((l) => l.lotId)))]);
  const locs = await locationsById(
    tx,
    events.map((e) => e.locationId),
  );
  const partners = await partnersById(
    tx,
    events.map((e) => e.partnerId),
  );
  const voids = new Map(
    (await tx.traceEvent.findMany({ where: { voidsEventId: { in: events.map((e) => e.id) } } })).map((v) => [
      v.voidsEventId as string,
      v,
    ]),
  );
  return events.map((e) => {
    const v = voids.get(e.id);
    return {
      id: e.id,
      type: e.type as EventOut["type"],
      process: e.process,
      occurredAt: e.occurredAt.toISOString(),
      recordedAt: e.recordedAt.toISOString(),
      location: e.locationId ? (locs.get(e.locationId) ?? null) : null,
      partner: e.partnerId ? (partners.get(e.partnerId) ?? null) : null,
      kdes: e.kdes as Record<string, unknown>,
      kdeSchema: e.kdeSchema,
      note: e.note,
      voidsEventId: e.voidsEventId,
      voidedBy: v ? { id: v.id, reason: v.note, recordedAt: v.recordedAt.toISOString() } : null,
      overrideReason: e.overrideReason,
      massBalance: e.massBalance ?? null,
      actorId: e.actorId,
      lines: e.lines
        .map((l) => {
          const r = refs.get(l.lotId);
          return r
            ? {
                role: l.role as "input" | "output" | "adjust",
                quantity: q(l.quantity),
                uomCode: l.uomCode,
                lot: r.ref,
              }
            : null;
        })
        .filter((x): x is NonNullable<typeof x> => x !== null),
    };
  });
};

const lotDtos = async (tx: Tx, ids: string[]): Promise<LotOut[]> => {
  const refs = await lotRefs(tx, ids);
  const locs = await locationsById(
    tx,
    [...refs.values()].map((r) => r.lot.locationId),
  );
  return ids
    .map((id) => refs.get(id))
    .filter((r): r is NonNullable<typeof r> => !!r)
    .map(({ lot, ref, version }) => ({
      id: lot.id,
      lotCode: lot.lotCode,
      product: {
        id: lot.productId,
        sku: ref.productSku,
        name: ref.productName,
        version: ref.productVersion,
        versionId: lot.productVersionId,
        category: version?.category ?? "other",
      },
      uomCode: lot.uomCode,
      quantity: q(lot.quantity),
      initialQuantity: q(lot.initialQuantity),
      status: lot.status as LotOut["status"],
      holdReason: lot.holdReason,
      location: lot.locationId ? (locs.get(lot.locationId) ?? null) : null,
      createdByEventId: lot.createdByEventId,
      createdAt: lot.createdAt.toISOString(),
      updatedAt: lot.updatedAt.toISOString(),
    }));
};

export interface LotFilter {
  productId?: string;
  status?: string;
  q?: string;
  limit: number;
  cursor?: string;
}

export const listLots = (db: Db, orgId: string, f: LotFilter) =>
  withTenant(db, orgId, async (tx) => {
    const rows = await tx.lot.findMany({
      where: {
        ...(f.productId ? { productId: f.productId } : {}),
        ...(f.status ? { status: f.status } : { status: { not: "voided" } }),
        ...(f.q ? { lotCode: { contains: f.q, mode: "insensitive" as const } } : {}),
        ...(f.cursor ? { id: { lt: f.cursor } } : {}),
      },
      orderBy: { id: "desc" },
      take: f.limit + 1,
      select: { id: true },
    });
    const page = rows.slice(0, f.limit);
    return {
      items: await lotDtos(
        tx,
        page.map((r) => r.id),
      ),
      nextCursor: rows.length > f.limit ? (page.at(-1)?.id ?? null) : null,
    };
  });

export const getLot = (db: Db, orgId: string, lotId: string) =>
  withTenant(db, orgId, async (tx) => {
    const [lot] = await lotDtos(tx, [lotId]);
    if (!lot) throw new AppError("NOT_FOUND", "Lot not found.");
    const events = await tx.traceEvent.findMany({
      where: { lines: { some: { lotId } } },
      include: { lines: true },
      orderBy: [{ occurredAt: "asc" }, { recordedAt: "asc" }],
    });
    return { ...lot, events: await eventDtos(tx, events) };
  });

export const listEvents = (db: Db, orgId: string, f: { type?: string; limit: number; cursor?: string }) =>
  withTenant(db, orgId, async (tx) => {
    const rows = await tx.traceEvent.findMany({
      where: { ...(f.type ? { type: f.type } : {}), ...(f.cursor ? { id: { lt: f.cursor } } : {}) },
      include: { lines: true },
      orderBy: { id: "desc" },
      take: f.limit + 1,
    });
    const page = rows.slice(0, f.limit);
    return {
      items: await eventDtos(tx, page),
      nextCursor: rows.length > f.limit ? (page.at(-1)?.id ?? null) : null,
    };
  });

export const getEvent = (db: Db, orgId: string, eventId: string) =>
  withTenant(db, orgId, async (tx) => {
    const e = await tx.traceEvent.findUnique({ where: { id: eventId }, include: { lines: true } });
    if (!e) throw new AppError("NOT_FOUND", "Event not found.");
    const [dto] = await eventDtos(tx, [e]);
    return dto as EventOut;
  });

// ─── trace ──────────────────────────────────────────────────────────────────

export const MAX_TRACE_NODES = 5000;

/**
 * Walks the genealogy with a recursive query (roadmap-v2 §4.2). Voided events are ignored.
 * Each lot appears once, at its shortest distance from the root.
 */
const walk = async (tx: Tx, rootLotId: string, direction: "backward" | "forward", maxDepth: number) => {
  const rows =
    direction === "backward"
      ? await tx.$queryRaw<{ lot_id: string; depth: number }[]>`
          WITH RECURSIVE up(lot_id, depth) AS (
            SELECT ${rootLotId}::uuid, 0
            UNION
            SELECT e.parent_lot_id, up.depth + 1
            FROM lot_edge e JOIN up ON e.child_lot_id = up.lot_id
            WHERE up.depth < ${maxDepth}
              AND NOT EXISTS (SELECT 1 FROM trace_event v WHERE v.voids_event_id = e.event_id)
          )
          SELECT lot_id, MIN(depth)::int AS depth FROM up GROUP BY lot_id ORDER BY 2 LIMIT ${MAX_TRACE_NODES + 1}`
      : await tx.$queryRaw<{ lot_id: string; depth: number }[]>`
          WITH RECURSIVE down(lot_id, depth) AS (
            SELECT ${rootLotId}::uuid, 0
            UNION
            SELECT e.child_lot_id, down.depth + 1
            FROM lot_edge e JOIN down ON e.parent_lot_id = down.lot_id
            WHERE down.depth < ${maxDepth}
              AND NOT EXISTS (SELECT 1 FROM trace_event v WHERE v.voids_event_id = e.event_id)
          )
          SELECT lot_id, MIN(depth)::int AS depth FROM down GROUP BY lot_id ORDER BY 2 LIMIT ${MAX_TRACE_NODES + 1}`;
  return rows.map((r) => ({ lotId: r.lot_id, depth: direction === "backward" ? -r.depth : r.depth }));
};

export const trace = (
  db: Db,
  orgId: string,
  rootLotId: string,
  direction: "backward" | "forward" | "both",
  maxDepth: number,
) =>
  withTenant(db, orgId, async (tx): Promise<TraceResult> => {
    const started = performance.now();
    if (!(await tx.lot.count({ where: { id: rootLotId } })))
      throw new AppError("NOT_FOUND", "Lot not found.");
    const up = direction === "forward" ? [] : await walk(tx, rootLotId, "backward", maxDepth);
    const down = direction === "backward" ? [] : await walk(tx, rootLotId, "forward", maxDepth);
    const depthOf = new Map<string, number>();
    for (const n of [...up, ...down])
      if (!depthOf.has(n.lotId) || n.depth === 0) depthOf.set(n.lotId, n.depth);
    const truncated = depthOf.size > MAX_TRACE_NODES;
    const ids = [...depthOf.keys()].slice(0, MAX_TRACE_NODES);

    const edges = await tx.$queryRaw<
      { parent_lot_id: string; child_lot_id: string; event_id: string; process: string | null }[]
    >`
      SELECT e.parent_lot_id, e.child_lot_id, e.event_id, ev.process
      FROM lot_edge e JOIN trace_event ev ON ev.id = e.event_id
      WHERE e.parent_lot_id = ANY(${ids}::uuid[]) AND e.child_lot_id = ANY(${ids}::uuid[])
        AND NOT EXISTS (SELECT 1 FROM trace_event v WHERE v.voids_event_id = e.event_id)`;

    const lots = await tx.lot.findMany({ where: { id: { in: ids } } });
    const versions = new Map(
      (
        await tx.productVersion.findMany({
          where: { id: { in: [...new Set(lots.map((l) => l.productVersionId))] } },
        })
      ).map((v) => [v.id, v]),
    );
    const products = new Map(
      (await tx.product.findMany({ where: { id: { in: [...new Set(lots.map((l) => l.productId))] } } })).map(
        (p) => [p.id, p],
      ),
    );
    const creators = new Map(
      (await tx.traceEvent.findMany({ where: { id: { in: lots.map((l) => l.createdByEventId) } } })).map(
        (e) => [e.id, e],
      ),
    );
    const locs = await locationsById(
      tx,
      [...creators.values()].map((e) => e.locationId),
    );
    const partners = await partnersById(
      tx,
      [...creators.values()].map((e) => e.partnerId),
    );

    const nodes = lots
      .map((l) => {
        const c = creators.get(l.createdByEventId);
        const v = versions.get(l.productVersionId);
        return {
          lotId: l.id,
          lotCode: l.lotCode,
          productSku: products.get(l.productId)?.sku ?? "",
          productName: v?.name ?? "",
          status: l.status,
          quantity: q(l.quantity),
          initialQuantity: q(l.initialQuantity),
          uomCode: l.uomCode,
          depth: depthOf.get(l.id) ?? 0,
          origin: c
            ? {
                eventType: c.type,
                occurredAt: c.occurredAt.toISOString(),
                location: c.locationId ? (locs.get(c.locationId)?.code ?? null) : null,
                partner: c.partnerId ? (partners.get(c.partnerId)?.name ?? null) : null,
              }
            : null,
        };
      })
      .sort((a, b) => a.depth - b.depth || a.lotCode.localeCompare(b.lotCode));

    const downstreamIds = ids.filter((id) => (depthOf.get(id) ?? 0) >= 0);
    const shipRows = downstreamIds.length
      ? await tx.$queryRaw<
          {
            lot_id: string;
            event_id: string;
            partner_id: string | null;
            quantity: string;
            uom_code: string;
            occurred_at: Date;
          }[]
        >`
          SELECT ln.lot_id, e.id AS event_id, e.partner_id, ln.quantity::text AS quantity, ln.uom_code, e.occurred_at
          FROM trace_event_line ln JOIN trace_event e ON e.id = ln.event_id
          WHERE e.type = 'SHIP' AND ln.role = 'input' AND ln.lot_id = ANY(${downstreamIds}::uuid[])
            AND NOT EXISTS (SELECT 1 FROM trace_event v WHERE v.voids_event_id = e.id)
          ORDER BY e.occurred_at`
      : [];
    const shipPartners = await partnersById(
      tx,
      shipRows.map((s) => s.partner_id),
    );
    const upstream = lots.filter((l) => (depthOf.get(l.id) ?? 0) <= 0);
    const suppliers = upstream
      .map((l) => ({ l, c: creators.get(l.createdByEventId) }))
      .filter(({ c }) => c?.type === "RECEIVE")
      .map(({ l, c }) => ({
        lotId: l.id,
        partnerId: c?.partnerId ?? null,
        partnerName: c?.partnerId ? (partners.get(c.partnerId)?.name ?? null) : null,
        supplierLotCode: ((c?.kdes as { supplierLotCode?: string } | null)?.supplierLotCode ?? null) as
          | string
          | null,
      }));

    return {
      rootLotId,
      direction,
      nodes,
      edges: edges.map((e) => ({
        parentLotId: e.parent_lot_id,
        childLotId: e.child_lot_id,
        eventId: e.event_id,
        process: e.process,
      })),
      shipments: shipRows.map((s) => ({
        lotId: s.lot_id,
        eventId: s.event_id,
        partnerId: s.partner_id,
        partnerName: s.partner_id ? (shipPartners.get(s.partner_id)?.name ?? null) : null,
        quantity: q(s.quantity),
        uomCode: s.uom_code,
        occurredAt: s.occurred_at.toISOString(),
      })),
      suppliers,
      truncated,
      maxDepth,
      elapsedMs: Math.round(performance.now() - started),
    };
  });

// ─── trace report (CSV) ─────────────────────────────────────────────────────

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);
  // Neutralise spreadsheet formulas and quote when needed.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};

export const REPORT_COLUMNS = [
  "occurred_at",
  "recorded_at",
  "event_id",
  "event_type",
  "process",
  "location_code",
  "location_name",
  "partner",
  "lot_code",
  "product_sku",
  "product_name",
  "product_version",
  "role",
  "quantity",
  "uom",
  "trace_depth",
  "kdes",
  "note",
] as const;

/**
 * Sortable CSV of every key data element for a lot's full chain, upstream and downstream
 * (FSMA 204-style "within 24 hours" report; roadmap-v2 P5). One row per lot per event.
 */
export const traceReport = async (db: Db, orgId: string, lotId: string) => {
  const t = await trace(db, orgId, lotId, "both", 50);
  return withTenant(db, orgId, async (tx) => {
    const ids = t.nodes.map((n) => n.lotId);
    const depth = new Map(t.nodes.map((n) => [n.lotId, n.depth]));
    const events = await tx.traceEvent.findMany({
      where: { lines: { some: { lotId: { in: ids } } }, type: { not: "VOID" } },
      include: { lines: true },
      orderBy: [{ occurredAt: "asc" }, { recordedAt: "asc" }],
    });
    const voided = new Set(
      (await tx.traceEvent.findMany({ where: { voidsEventId: { in: events.map((e) => e.id) } } })).map(
        (v) => v.voidsEventId,
      ),
    );
    const dtos = await eventDtos(
      tx,
      events.filter((e) => !voided.has(e.id)),
    );
    const rows = [REPORT_COLUMNS.join(",")];
    for (const e of dtos) {
      for (const l of e.lines) {
        if (!depth.has(l.lot.id)) continue;
        rows.push(
          [
            e.occurredAt,
            e.recordedAt,
            e.id,
            e.type,
            e.process,
            e.location?.code,
            e.location?.name,
            e.partner?.name,
            l.lot.lotCode,
            l.lot.productSku,
            l.lot.productName,
            l.lot.productVersion,
            l.role,
            l.quantity,
            l.uomCode,
            depth.get(l.lot.id),
            e.kdes,
            e.note,
          ]
            .map(csvCell)
            .join(","),
        );
      }
    }
    return {
      csv: `${rows.join("\n")}\n`,
      lotCode: t.nodes.find((n) => n.depth === 0)?.lotCode ?? lotId,
      truncated: t.truncated,
    };
  });
};
