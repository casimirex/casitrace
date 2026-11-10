import type { TraceResult } from "@casitrace/contracts";
import type { Db } from "@casitrace/db";
import { withTenant } from "../../../platform/tenant";
import {
  csvCell,
  eventDtos,
  MAX_TRACE_NODES,
  REPORT_COLUMNS,
  traceLocal,
} from "../../traceability/application/queries";
import { findLotGrant, type LotGrant, logSharedAccess } from "./grants";
import { orgIdentities } from "./orgs";

type Node = TraceResult["nodes"][number];
type Edge = TraceResult["edges"][number];

export interface Viewer {
  orgId: string;
  actorId: string | null;
}

/** A part of the chain held by one organisation, and the grant that made it visible (null = own data). */
interface Segment {
  orgId: string;
  lotIds: string[];
  grant: LotGrant | null;
}

/**
 * Trace across organisations (roadmap-v2 P6). Starts with the viewer's own genealogy, then follows
 * handoffs: into another organisation's records only where that organisation granted the viewer
 * access (to the viewer itself or to every downstream holder), up to the granted depth. Otherwise the
 * other side appears as a redacted node: the organisation and its verification status, nothing else.
 * Nothing is dropped silently: the result is marked truncated when the node limit is reached.
 */
export const traceAcross = async (
  db: Db,
  viewer: Viewer,
  rootLotId: string,
  direction: "backward" | "forward" | "both",
  maxDepth: number,
): Promise<TraceResult & { segments: Segment[] }> => {
  const started = performance.now();
  const local = await traceLocal(db, viewer.orgId, rootLotId, direction, maxDepth);
  const nodes = new Map<string, Node>(local.nodes.map((n) => [n.lotId, n]));
  const edges: Edge[] = [...local.edges];
  const shipments = [...local.shipments];
  const suppliers = [...local.suppliers];
  const segments: Segment[] = [{ orgId: viewer.orgId, lotIds: local.nodes.map((n) => n.lotId), grant: null }];
  let truncated = local.truncated;

  type Frontier = { orgId: string; nodes: Node[] };
  const redacted = async (orgId: string, linkId: string, depth: number): Promise<Node> => {
    const id = (await orgIdentities(db, [orgId])).get(orgId) ?? {
      id: orgId,
      name: "Another organisation",
      verified: false,
    };
    return {
      lotId: linkId,
      org: id,
      redacted: true,
      lotCode: "",
      productSku: "",
      productName: "",
      status: "",
      quantity: "",
      initialQuantity: "",
      uomCode: "",
      depth,
      origin: null,
    };
  };

  const expand = async (start: Frontier, dir: "backward" | "forward") => {
    const queue: Frontier[] = [start];
    while (queue.length) {
      const f = queue.shift() as Frontier;
      const candidates = f.nodes.filter(
        (n) => !n.redacted && (dir === "backward" ? n.depth <= 0 : n.depth >= 0),
      );
      if (!candidates.length) continue;
      const depthOf = new Map(candidates.map((n) => [n.lotId, n.depth]));
      // Cross-organisation links visible to the holder of these lots (RLS: either party).
      const links = await withTenant(db, f.orgId, (tx) =>
        tx.crossLotLink.findMany({
          where:
            dir === "backward"
              ? { downstreamOrgId: f.orgId, downstreamLotId: { in: candidates.map((n) => n.lotId) } }
              : { upstreamOrgId: f.orgId, upstreamLotId: { in: candidates.map((n) => n.lotId) } },
        }),
      );
      for (const link of links) {
        if (nodes.size >= MAX_TRACE_NODES) {
          truncated = true;
          return;
        }
        const here = dir === "backward" ? link.downstreamLotId : link.upstreamLotId;
        const there = dir === "backward" ? link.upstreamLotId : link.downstreamLotId;
        const otherOrg = dir === "backward" ? link.upstreamOrgId : link.downstreamOrgId;
        const hereDepth = depthOf.get(here) ?? 0;
        const thereDepth = dir === "backward" ? hereDepth - 1 : hereDepth + 1;
        if (Math.abs(thereDepth) > maxDepth || nodes.has(there) || nodes.has(link.id)) continue;
        const edge = (otherId: string): Edge =>
          dir === "backward"
            ? { parentLotId: otherId, childLotId: here, eventId: link.handoffId, process: "handoff" }
            : { parentLotId: here, childLotId: otherId, eventId: link.handoffId, process: "handoff" };

        // The viewer's own lots further along the chain need no grant (e.g. it shipped and received back).
        const grant =
          otherOrg === viewer.orgId ? null : await findLotGrant(db, otherOrg, viewer.orgId, there);
        const allowed =
          otherOrg === viewer.orgId
            ? maxDepth
            : grant
              ? dir === "backward"
                ? grant.upstreamDepth
                : grant.downstreamDepth
              : -1;
        if (allowed < 0) {
          const n = await redacted(otherOrg, link.id, thereDepth);
          nodes.set(n.lotId, n);
          edges.push(edge(n.lotId));
          continue;
        }
        const remaining = Math.min(allowed, maxDepth - Math.abs(thereDepth));
        const remote = await traceLocal(db, otherOrg, there, dir, Math.max(remaining, 0));
        if (remote.truncated) truncated = true;
        const shifted = remote.nodes.map((n) => ({ ...n, depth: thereDepth + n.depth }));
        const added: Node[] = [];
        for (const n of shifted) {
          if (nodes.has(n.lotId)) continue;
          nodes.set(n.lotId, n);
          added.push(n);
        }
        edges.push(edge(there), ...remote.edges);
        // Backward: the other side's own suppliers are part of the shared history; its other customers are not.
        // Forward: where the product went is shared; the other side's other inputs are not.
        if (dir === "backward") suppliers.push(...remote.suppliers);
        else shipments.push(...remote.shipments);
        segments.push({ orgId: otherOrg, lotIds: added.map((n) => n.lotId), grant });
        if (grant) await logSharedAccess(db, grant, viewer, "trace", there);
        queue.push({ orgId: otherOrg, nodes: added });
      }
    }
  };

  if (direction !== "forward") await expand({ orgId: viewer.orgId, nodes: local.nodes }, "backward");
  if (direction !== "backward") await expand({ orgId: viewer.orgId, nodes: local.nodes }, "forward");

  return {
    ...local,
    nodes: [...nodes.values()].sort(
      (a, b) =>
        a.depth - b.depth || a.org.name.localeCompare(b.org.name) || a.lotCode.localeCompare(b.lotCode),
    ),
    edges,
    shipments,
    suppliers,
    truncated,
    elapsedMs: Math.round(performance.now() - started),
    segments,
  };
};

/** Public form of a trace (segments are internal). */
export const trace = async (
  db: Db,
  viewer: Viewer,
  rootLotId: string,
  direction: "backward" | "forward" | "both",
  maxDepth: number,
) => {
  const { segments: _segments, ...result } = await traceAcross(db, viewer, rootLotId, direction, maxDepth);
  return result;
};

/**
 * Sortable CSV of every key data element in the chain (roadmap-v2 P5/P6): the viewer's own events,
 * plus other organisations' events where their grant includes key data elements. Redacted parts
 * appear as one row naming the organisation.
 */
export const traceReport = async (db: Db, viewer: Viewer, lotId: string) => {
  const t = await traceAcross(db, viewer, lotId, "both", 50);
  const depth = new Map(t.nodes.map((n) => [n.lotId, n.depth]));
  const rows = [["organisation", ...REPORT_COLUMNS].join(",")];
  const lines: { sort: string; row: string }[] = [];

  for (const seg of t.segments) {
    if (!seg.lotIds.length) continue;
    const own = seg.orgId === viewer.orgId;
    if (!own && !seg.grant?.includeKdes) continue;
    const orgName = t.nodes.find((n) => n.org.id === seg.orgId)?.org.name ?? "";
    const dtos = await withTenant(db, seg.orgId, async (tx) => {
      const events = await tx.traceEvent.findMany({
        where: { lines: { some: { lotId: { in: seg.lotIds } } }, type: { not: "VOID" } },
        include: { lines: true },
        orderBy: [{ occurredAt: "asc" }, { recordedAt: "asc" }],
      });
      const voided = new Set(
        (await tx.traceEvent.findMany({ where: { voidsEventId: { in: events.map((e) => e.id) } } })).map(
          (v) => v.voidsEventId,
        ),
      );
      return eventDtos(
        tx,
        events.filter((e) => !voided.has(e.id)),
      );
    });
    if (!own && seg.grant)
      await logSharedAccess(db, seg.grant, viewer, "trace_report", seg.lotIds[0] ?? null);
    const segLots = new Set(seg.lotIds);
    for (const e of dtos) {
      for (const l of e.lines) {
        if (!segLots.has(l.lot.id)) continue;
        // Other organisations' partners are only named in their shipments and receipts within the shared chain.
        lines.push({
          sort: e.occurredAt,
          row: [
            orgName,
            e.occurredAt,
            e.recordedAt,
            e.id,
            e.type,
            e.process,
            e.location?.code,
            e.location?.name,
            own || e.type !== "SHIP" ? e.partner?.name : "",
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
        });
      }
    }
  }
  for (const n of t.nodes.filter((x) => x.redacted)) {
    lines.push({
      sort: "",
      row: [
        n.org.name,
        "",
        "",
        "",
        "NOT_SHARED",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        n.depth,
        "",
        `${n.org.name} has not shared this part of the chain`,
      ]
        .map(csvCell)
        .join(","),
    });
  }
  lines.sort((a, b) => a.sort.localeCompare(b.sort));
  rows.push(...lines.map((l) => l.row));
  return {
    csv: `${rows.join("\n")}\n`,
    lotCode: t.nodes.find((n) => n.depth === 0 && !n.redacted)?.lotCode ?? lotId,
    truncated: t.truncated,
  };
};
