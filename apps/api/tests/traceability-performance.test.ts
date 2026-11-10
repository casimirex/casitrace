/**
 * NFR (docs/architecture/non-functional-requirements.md): backward/forward trace over 10 hops and
 * 5,000 lots, p95 < 2 s. Seeds 10 levels × 500 lots; every lot above level 0 has 4 random parents,
 * so a single trace reaches thousands of lots.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Prisma } from "@casitrace/db";
import { newId } from "@casitrace/shared";
import { trace } from "../src/modules/traceability/application/queries";
import { createOrg, verifiedUser } from "./auth-helpers";
import { buildApp, db } from "./helpers";

afterAll(() => db.$disconnect());
const app = buildApp();

const LEVELS = 10;
const PER_LEVEL = 500;
let orgId = "";
const levels: string[][] = [];

beforeAll(async () => {
  const owner = await verifiedUser(app, "perf");
  orgId = await createOrg(owner.client, "Perf Mill");
  const res = await owner.client.call("POST", `/api/v1/orgs/${orgId}/products`, {
    sku: "OLV",
    name: "Olives",
    category: "olives",
    uomCode: "kg",
  });
  const productId = ((await res.json()) as { id: string }).id;
  const version = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.org_id', ${orgId}, true)`;
    return tx.productVersion.findFirstOrThrow({ where: { productId } });
  });

  let seed = 1;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let level = 0; level < LEVELS; level++) {
    const events: Prisma.TraceEventCreateManyInput[] = [];
    const lots: Prisma.LotCreateManyInput[] = [];
    const edges: Prisma.LotEdgeCreateManyInput[] = [];
    const ids: string[] = [];
    for (let i = 0; i < PER_LEVEL; i++) {
      const eventId = newId();
      const lotId = newId();
      ids.push(lotId);
      events.push({
        id: eventId,
        orgId,
        type: level === 0 ? "ORIGINATE" : "TRANSFORM",
        process: level === 0 ? "harvest" : "other",
        occurredAt: new Date(Date.now() - (LEVELS - level) * 3_600_000),
        kdes: {},
        kdeSchema: "perf@1",
      });
      lots.push({
        id: lotId,
        orgId,
        productId,
        productVersionId: version.id,
        lotCode: `L${level}-${i}`,
        uomCode: "kg",
        quantity: "100",
        initialQuantity: "100",
        createdByEventId: eventId,
      });
      if (level > 0) {
        const prev = levels[level - 1] as string[];
        const parents = new Set<string>();
        while (parents.size < 4) parents.add(prev[Math.floor(rand() * PER_LEVEL)] as string);
        for (const parentLotId of parents)
          edges.push({ id: newId(), orgId, parentLotId, childLotId: lotId, eventId });
      }
    }
    levels.push(ids);
    await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.org_id', ${orgId}, true)`;
        await tx.traceEvent.createMany({ data: events });
        await tx.lot.createMany({ data: lots });
        if (edges.length) await tx.lotEdge.createMany({ data: edges });
      },
      { timeout: 60_000 },
    );
  }
}, 180_000);

const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1] ?? 0;

describe("trace performance (5,000 lots, 10 hops)", () => {
  test("backward from the top level and forward from the bottom level: p95 < 2 s", async () => {
    const back: number[] = [];
    const fwd: number[] = [];
    let backNodes = 0;
    let fwdNodes = 0;
    for (let i = 0; i < 20; i++) {
      const top = (levels[LEVELS - 1] as string[])[i * 7] as string;
      const bottom = (levels[0] as string[])[i * 11] as string;
      let t = performance.now();
      const b = await trace(db, orgId, top, "backward", 20);
      back.push(performance.now() - t);
      backNodes = Math.max(backNodes, b.nodes.length);
      t = performance.now();
      const f = await trace(db, orgId, bottom, "forward", 20);
      fwd.push(performance.now() - t);
      fwdNodes = Math.max(fwdNodes, f.nodes.length);
    }
    console.log(
      `trace p95: backward ${p95(back).toFixed(0)} ms (up to ${backNodes} lots), forward ${p95(fwd).toFixed(0)} ms (up to ${fwdNodes} lots)`,
    );
    // The traces really span the 10 levels and thousands of lots.
    expect(backNodes).toBeGreaterThan(1000);
    expect(fwdNodes).toBeGreaterThan(1000);
    expect(p95(back)).toBeLessThan(2000);
    expect(p95(fwd)).toBeLessThan(2000);
  }, 120_000);
});
