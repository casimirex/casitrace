/**
 * Property-based checks of the traceability core (roadmap-v2 P5 exit gate): random sequences of
 * harvests, splits, merges, transforms, shipments, adjustments and voids must keep the genealogy
 * acyclic, never create mass, and keep every lot balance equal to a fresh recomputation from events.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { type Ctx, recordEvent, voidEvent } from "../src/modules/traceability/application/events";
import { D } from "../src/modules/traceability/domain/quantity";
import { withTenant } from "../src/platform/tenant";
import { createOrg, verifiedUser } from "./auth-helpers";
import { buildApp, db } from "./helpers";

afterAll(() => db.$disconnect());
const app = buildApp();

/** Small seeded PRNG (mulberry32) so failures are reproducible from the printed seed. */
const prng = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const invariants = async (orgId: string) =>
  withTenant(db, orgId, async (tx) => {
    // 1. Every lot balance equals the recomputation from non-voided event lines, and is ≥ 0.
    const mismatches = await tx.$queryRaw<{ id: string }[]>`
      SELECT l.id FROM lot l
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(CASE ln.role WHEN 'output' THEN ln.quantity WHEN 'input' THEN -ln.quantity ELSE ln.quantity END), 0) AS q
        FROM trace_event_line ln
        WHERE ln.lot_id = l.id AND NOT EXISTS (SELECT 1 FROM trace_event v WHERE v.voids_event_id = ln.event_id)
      ) s ON true
      WHERE l.quantity <> s.q OR l.quantity < 0`;
    // 2. Mass is never created: current stock + shipped + consumed-into-transforms-minus-outputs ≤ originated + net adjustments.
    const [totals] = await tx.$queryRaw<
      { originated: string; adjusted: string; balance: string; shipped: string }[]
    >`
      WITH live AS (
        SELECT ln.* , e.type FROM trace_event_line ln JOIN trace_event e ON e.id = ln.event_id
        WHERE NOT EXISTS (SELECT 1 FROM trace_event v WHERE v.voids_event_id = e.id)
      )
      SELECT
        COALESCE((SELECT SUM(quantity) FROM live WHERE type = 'ORIGINATE' AND role = 'output'), 0)::text AS originated,
        COALESCE((SELECT SUM(quantity) FROM live WHERE role = 'adjust'), 0)::text AS adjusted,
        COALESCE((SELECT SUM(quantity) FROM lot WHERE status <> 'voided'), 0)::text AS balance,
        COALESCE((SELECT SUM(quantity) FROM live WHERE type = 'SHIP' AND role = 'input'), 0)::text AS shipped`;
    // 3. Genealogy (non-voided edges) has no cycle.
    const [cycle] = await tx.$queryRaw<{ found: boolean }[]>`
      WITH RECURSIVE walk(start, node, path, cyc) AS (
        SELECT e.parent_lot_id, e.child_lot_id, ARRAY[e.parent_lot_id, e.child_lot_id], false
        FROM lot_edge e WHERE NOT EXISTS (SELECT 1 FROM trace_event v WHERE v.voids_event_id = e.event_id)
        UNION ALL
        SELECT w.start, e.child_lot_id, w.path || e.child_lot_id, e.child_lot_id = ANY(w.path)
        FROM walk w JOIN lot_edge e ON e.parent_lot_id = w.node
        WHERE NOT w.cyc AND NOT EXISTS (SELECT 1 FROM trace_event v WHERE v.voids_event_id = e.event_id)
      )
      SELECT EXISTS (SELECT 1 FROM walk WHERE cyc) AS found`;
    // 4. Each lot made by a live transformation has at least one live parent.
    const orphans = await tx.$queryRaw<{ id: string }[]>`
      SELECT l.id FROM lot l JOIN trace_event e ON e.id = l.created_by_event_id
      WHERE e.type = 'TRANSFORM' AND l.status <> 'voided'
        AND NOT EXISTS (SELECT 1 FROM lot_edge x WHERE x.child_lot_id = l.id
                        AND NOT EXISTS (SELECT 1 FROM trace_event v WHERE v.voids_event_id = x.event_id))`;
    // 5. Every live transformation, recomputed from its stored lines, is within 2 % (all kg here).
    const overweight = await tx.$queryRaw<{ id: string }[]>`
      SELECT e.id FROM trace_event e JOIN trace_event_line ln ON ln.event_id = e.id
      WHERE e.type = 'TRANSFORM' AND e.override_reason IS NULL
        AND NOT EXISTS (SELECT 1 FROM trace_event v WHERE v.voids_event_id = e.id)
      GROUP BY e.id
      HAVING SUM(ln.quantity) FILTER (WHERE ln.role = 'output') > SUM(ln.quantity) FILTER (WHERE ln.role = 'input') * 1.02`;
    return { mismatches, totals, cycle: cycle?.found ?? true, orphans, overweight };
  });

describe("random event sequences keep the invariants", () => {
  const seeds = [7, 42, 20261110];
  for (const seed of seeds) {
    test(`seed ${seed}: 150 operations`, async () => {
      const rand = prng(seed);
      const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)] as T;
      const owner = await verifiedUser(app, `prop-${seed}`);
      const orgId = await createOrg(owner.client, `Prop ${seed}`);
      const base = `/api/v1/orgs/${orgId}`;
      const post = async (path: string, body: unknown) =>
        ((await (await owner.client.call("POST", `${base}${path}`, body)).json()) as { id: string }).id;
      const olives = await post("/products", {
        sku: "OLV",
        name: "Olives",
        category: "olives",
        uomCode: "kg",
      });
      const plot = await post("/locations", { code: "P", name: "Plot", type: "plot" });
      const customer = await post("/partners", { name: "Shop", kind: "customer" });
      const ctx: Ctx = { actor: { type: "user", id: owner.userId }, orgId, requestId: null, role: "owner" };
      const at = () => new Date(Date.now() - Math.floor(rand() * 86_400_000)).toISOString();
      const qty = (max: number) => (Math.floor(rand() * max * 1000) / 1000 + 0.001).toFixed(3);

      const liveLots = async () =>
        withTenant(db, orgId, (tx) =>
          tx.lot.findMany({
            where: { status: "active", quantity: { gt: 0 } },
            select: { id: true, quantity: true },
          }),
        );
      const recorded: string[] = [];
      const counts: Record<string, number> = {};
      const attempt = async (name: string, fn: () => Promise<{ eventId?: string } | unknown>) => {
        try {
          const r = (await fn()) as { eventId?: string };
          if (r?.eventId) recorded.push(r.eventId);
          counts[name] = (counts[name] ?? 0) + 1;
        } catch (e) {
          // Refusals (e.g. voiding an event with dependants) are expected; anything else is a bug.
          const code = (e as { code?: string }).code;
          if (code !== "CONFLICT" && code !== "VALIDATION_FAILED") throw e;
          counts[`${name} refused`] = (counts[`${name} refused`] ?? 0) + 1;
        }
      };

      for (let i = 0; i < 150; i++) {
        const lots = await liveLots();
        const op =
          lots.length < 2
            ? "harvest"
            : pick(["harvest", "split", "merge", "transform", "transform", "ship", "adjust", "void"]);
        const lot = lots.length ? pick(lots) : null;
        const avail = lot ? Number(lot.quantity) : 0;
        if (op === "harvest") {
          await attempt(op, () =>
            recordEvent(db, ctx, {
              type: "ORIGINATE",
              process: "harvest",
              occurredAt: at(),
              locationId: plot,
              kdes: { cultivars: ["Coratina"] },
              inputs: [],
              outputs: [{ productId: olives, quantity: qty(1000) }],
            }),
          );
        } else if (op === "split" && lot) {
          const a = Math.max(0.001, Math.floor(avail * rand() * 1000) / 1000);
          const b = Math.max(0.001, Math.floor((avail - a) * rand() * 1000) / 1000);
          await attempt(op, () =>
            recordEvent(db, ctx, {
              type: "TRANSFORM",
              process: "split",
              occurredAt: at(),
              kdes: {},
              inputs: [{ lotId: lot.id, quantity: String(Math.min(avail, a + b)) }],
              outputs: [
                { productId: olives, quantity: String(a) },
                { productId: olives, quantity: String(b) },
              ],
            }),
          );
        } else if (op === "merge") {
          const two = [...new Set([pick(lots), pick(lots), pick(lots)].map((l) => l.id))].slice(0, 2);
          if (two.length < 2) continue;
          const parts = lots.filter((l) => two.includes(l.id));
          const total = parts.reduce((s, l) => s.add(D(l.quantity)), D(0));
          await attempt(op, () =>
            recordEvent(db, ctx, {
              type: "TRANSFORM",
              process: "blending",
              occurredAt: at(),
              kdes: {},
              inputs: parts.map((l) => ({ lotId: l.id, quantity: l.quantity.toString() })),
              outputs: [{ productId: olives, quantity: total.toString() }],
            }),
          );
        } else if (op === "transform" && lot) {
          // Random yield between 0 and 110 % (above 102 % must be refused by mass balance).
          const out = Math.max(0.001, Math.floor(avail * rand() * 1.1 * 1000) / 1000);
          await attempt(op, () =>
            recordEvent(db, ctx, {
              type: "TRANSFORM",
              process: "other",
              occurredAt: at(),
              kdes: { description: "process" },
              inputs: [{ lotId: lot.id, quantity: lot.quantity.toString() }],
              outputs: [{ productId: olives, quantity: String(out) }],
            }),
          );
        } else if (op === "ship" && lot) {
          await attempt(op, () =>
            recordEvent(db, ctx, {
              type: "SHIP",
              occurredAt: at(),
              partnerId: customer,
              kdes: {},
              inputs: [
                {
                  lotId: lot.id,
                  quantity: String(Math.max(0.001, Math.floor(avail * rand() * 1000) / 1000)),
                },
              ],
              outputs: [],
            }),
          );
        } else if (op === "adjust" && lot) {
          const delta =
            rand() < 0.5 ? -Math.floor(avail * rand() * 1000) / 1000 : Math.floor(rand() * 50 * 1000) / 1000;
          if (delta === 0) continue;
          await attempt(op, () =>
            recordEvent(db, ctx, {
              type: "ADJUST",
              occurredAt: at(),
              kdes: { reason: "recount" },
              inputs: [],
              outputs: [],
              adjust: { lotId: lot.id, delta: String(delta) },
            }),
          );
        } else if (op === "void" && recorded.length) {
          await attempt(op, () => voidEvent(db, ctx, pick(recorded), "property test correction"));
        }

        if (i % 25 === 24 || i === 149) {
          const inv = await invariants(orgId);
          const t = inv.totals;
          if (!t) throw new Error("no totals");
          expect(inv.mismatches, `seed ${seed} step ${i}: balance mismatch`).toEqual([]);
          expect(inv.cycle, `seed ${seed} step ${i}: genealogy cycle`).toBe(false);
          expect(inv.orphans, `seed ${seed} step ${i}: transform output without parent`).toEqual([]);
          expect(inv.overweight, `seed ${seed} step ${i}: transformation created mass`).toEqual([]);
          // stock + shipped ≤ originated + adjustments (transforms can only lose mass, within the 2 % tolerance per step).
          const lhs = D(t.balance).add(D(t.shipped));
          const rhs = D(t.originated).add(D(t.adjusted));
          expect(lhs.lte(rhs.mul(1.02 ** 10)), `seed ${seed} step ${i}: mass created (${lhs} > ${rhs})`).toBe(
            true,
          );
        }
      }
      // The run must actually have exercised the operations, including refusals.
      expect(Object.keys(counts).length, JSON.stringify(counts)).toBeGreaterThanOrEqual(6);
      expect(
        counts["transform refused"] ?? 0,
        `mass-balance refusals: ${JSON.stringify(counts)}`,
      ).toBeGreaterThan(0);
    }, 120_000);
  }
});
