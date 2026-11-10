import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { withTenant } from "../src/platform/tenant";
import { addMember, type Client, createOrg, verifiedUser } from "./auth-helpers";
import { buildApp, db } from "./helpers";

afterAll(() => db.$disconnect());
const app = buildApp();

const json = async <T = Record<string, unknown>>(res: Response) => (await res.json()) as T;
type Ev = {
  id: string;
  lines: { role: string; quantity: string; lot: { id: string; lotCode: string } }[];
  overrideReason: string | null;
};
type Lot = { id: string; lotCode: string; quantity: string; status: string };
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

/** An olive mill with products, a grove plot, the mill, a supplier and a customer. */
export const setupMill = async (tag: string) => {
  const owner = await verifiedUser(app, `${tag}-owner`);
  const orgId = await createOrg(owner.client, `${tag} Mill`);
  const base = `/api/v1/orgs/${orgId}`;
  const c = owner.client;
  const create = async (path: string, body: unknown) => {
    const res = await c.call("POST", `${base}${path}`, body);
    if (res.status !== 201) throw new Error(`${path}: ${res.status} ${await res.text()}`);
    return ((await res.json()) as { id: string }).id;
  };
  const products = {
    olives: await create("/products", {
      sku: "OLV",
      name: "Coratina olives",
      category: "olives",
      uomCode: "kg",
      attributes: { cultivars: ["Coratina"] },
    }),
    oil: await create("/products", {
      sku: "EVO-BULK",
      name: "EVO bulk",
      category: "olive_oil_bulk",
      uomCode: "kg",
      attributes: { grade: "extra_virgin" },
      conversions: [{ fromUom: "l", toUom: "kg", factor: 0.916 }],
    }),
    bottle: await create("/products", {
      sku: "EVO-750",
      name: "EVO 750 ml",
      category: "olive_oil_packaged",
      uomCode: "unit",
      attributes: { grade: "extra_virgin", netVolumeMl: 750, container: "glass" },
      conversions: [{ fromUom: "l", toUom: "kg", factor: 0.916 }],
    }),
    pomace: await create("/products", {
      sku: "POMACE",
      name: "Wet pomace",
      category: "olive_pomace",
      uomCode: "kg",
    }),
  };
  const locations = {
    plot: await create("/locations", {
      code: "PLOT-1",
      name: "North grove",
      type: "plot",
      boundary: {
        type: "Polygon",
        coordinates: [
          [
            [16.287, 41.233],
            [16.29, 41.233],
            [16.29, 41.2345],
            [16.287, 41.2345],
            [16.287, 41.233],
          ],
        ],
      },
    }),
    mill: await create("/locations", { code: "MILL", name: "Mill", type: "facility" }),
  };
  const partners = {
    grower: await create("/partners", { name: "Azienda Di Bari", kind: "supplier" }),
    shop: await create("/partners", { name: "Gastronomia Rossi", kind: "customer" }),
  };
  const record = (body: Record<string, unknown>, client: Client = c) =>
    client.call("POST", `${base}/events`, body);
  const recordOk = async (body: Record<string, unknown>) => {
    const res = await record(body);
    if (res.status !== 201) throw new Error(`event: ${res.status} ${await res.text()}`);
    return json<Ev>(res);
  };
  const lot = async (id: string) => json<Lot & { events: Ev[] }>(await c.call("GET", `${base}/lots/${id}`));
  const out = (e: Ev, i = 0) => e.lines.filter((l) => l.role === "output")[i]?.lot.id ?? "";
  return { owner, orgId, base, c, products, locations, partners, record, recordOk, lot, out };
};

type Mill = Awaited<ReturnType<typeof setupMill>>;

/** grove harvest + supplier delivery → milling → bottling → shipment. */
const runChain = async (m: Mill) => {
  const harvest = await m.recordOk({
    type: "ORIGINATE",
    process: "harvest",
    occurredAt: hoursAgo(30),
    locationId: m.locations.plot,
    kdes: { cultivars: ["Coratina"], harvestMethod: "mechanical" },
    outputs: [{ productId: m.products.olives, lotCode: "H-PLOT1-01", quantity: "1000" }],
  });
  const receipt = await m.recordOk({
    type: "RECEIVE",
    occurredAt: hoursAgo(28),
    partnerId: m.partners.grower,
    locationId: m.locations.mill,
    kdes: { supplierLotCode: "DB-0412", deliveryNote: "DDT 118" },
    outputs: [{ productId: m.products.olives, lotCode: "R-DB-0412", quantity: "2000" }],
  });
  const milling = await m.recordOk({
    type: "TRANSFORM",
    process: "milling",
    occurredAt: hoursAgo(20),
    locationId: m.locations.mill,
    kdes: { extractionMethod: "two_phase", malaxationMaxTempC: 26, storageTank: "TANK-01" },
    inputs: [
      { lotId: m.out(harvest), quantity: "1000" },
      { lotId: m.out(receipt), quantity: "2000" },
    ],
    outputs: [
      { productId: m.products.oil, lotCode: "OIL-26-001", quantity: "480" },
      { productId: m.products.pomace, lotCode: "POM-26-001", quantity: "2300" },
    ],
  });
  const bottling = await m.recordOk({
    type: "TRANSFORM",
    process: "bottling",
    occurredAt: hoursAgo(10),
    locationId: m.locations.mill,
    kdes: { bestBefore: "2028-06-30" },
    inputs: [{ lotId: m.out(milling), quantity: "300" }],
    outputs: [{ productId: m.products.bottle, lotCode: "B750-26-001", quantity: "436" }],
  });
  const ship = await m.recordOk({
    type: "SHIP",
    occurredAt: hoursAgo(2),
    partnerId: m.partners.shop,
    kdes: { shipmentRef: "ORD-77", sscc: "380012345000000017" },
    inputs: [{ lotId: m.out(bottling), quantity: "400" }],
  });
  return { harvest, receipt, milling, bottling, ship };
};

let m: Mill;
let chain: Awaited<ReturnType<typeof runChain>>;

beforeAll(async () => {
  m = await setupMill("trace");
  chain = await runChain(m);
});

describe("recording the olive-oil chain", () => {
  test("balances and statuses follow the events", async () => {
    const harvest = await m.lot(m.out(chain.harvest));
    expect(harvest).toMatchObject({ quantity: "0", status: "consumed" });
    expect(await m.lot(m.out(chain.milling))).toMatchObject({ quantity: "180", status: "active" });
    expect(await m.lot(m.out(chain.bottling))).toMatchObject({ quantity: "36", status: "active" });
    const shipped = await m.recordOk({
      type: "SHIP",
      occurredAt: hoursAgo(1),
      partnerId: m.partners.shop,
      inputs: [{ lotId: m.out(chain.bottling), quantity: "36" }],
    });
    expect(await m.lot(m.out(chain.bottling))).toMatchObject({ quantity: "0", status: "shipped" });
    await m.c.call("POST", `${m.base}/events/${shipped.id}/void`, {
      reason: "Test cleanup of extra shipment",
    });
    expect(harvest.events.map((e) => (e as unknown as { type: string }).type)).toEqual([
      "ORIGINATE",
      "TRANSFORM",
    ]);
  });

  test("milling records the mass balance (oil yield 16 %)", async () => {
    const e = await json<{ massBalance: { inputKg: string; outputKg: string; ok: boolean } }>(
      await m.c.call("GET", `${m.base}/events/${chain.milling.id}`),
    );
    expect(e.massBalance).toMatchObject({ inputKg: "3000", outputKg: "2780", ok: true });
  });

  test("bottling converts units → litres → kg for the mass balance", async () => {
    const e = await json<{ massBalance: { inputKg: string; outputKg: string; ok: boolean } }>(
      await m.c.call("GET", `${m.base}/events/${chain.bottling.id}`),
    );
    // 436 × 0.75 l × 0.916 kg/l = 299.532 kg out of 300 kg
    expect(e.massBalance).toMatchObject({ inputKg: "300", outputKg: "299.532", ok: true });
  });
});

describe("trace", () => {
  type Trace = {
    nodes: { lotCode: string; depth: number }[];
    edges: unknown[];
    shipments: { partnerName: string; quantity: string }[];
    suppliers: { partnerName: string; supplierLotCode: string }[];
    elapsedMs: number;
  };
  test("backward from a bottle lot reaches the oil, the grove harvest and the supplier delivery", async () => {
    const t = await json<Trace>(
      await m.c.call("GET", `${m.base}/lots/${m.out(chain.bottling)}/trace?direction=backward`),
    );
    expect(t.nodes.map((n) => [n.lotCode, n.depth])).toEqual([
      ["H-PLOT1-01", -2],
      ["R-DB-0412", -2],
      ["OIL-26-001", -1],
      ["B750-26-001", 0],
    ]);
    expect(t.suppliers).toEqual([
      expect.objectContaining({ partnerName: "Azienda Di Bari", supplierLotCode: "DB-0412" }),
    ]);
  });

  test("forward from the supplier's olives reaches oil, pomace, bottles and the customer", async () => {
    const t = await json<Trace>(
      await m.c.call("GET", `${m.base}/lots/${m.out(chain.receipt)}/trace?direction=forward`),
    );
    expect(t.nodes.map((n) => n.lotCode).sort()).toEqual([
      "B750-26-001",
      "OIL-26-001",
      "POM-26-001",
      "R-DB-0412",
    ]);
    expect(t.shipments).toEqual([
      expect.objectContaining({ partnerName: "Gastronomia Rossi", quantity: "400" }),
    ]);
  });

  test("the trace report lists every KDE in the chain as CSV", async () => {
    const res = await m.c.call("GET", `${m.base}/lots/${m.out(chain.bottling)}/trace-report`);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain("trace-B750-26-001.csv");
    const csv = await res.text();
    const lines = csv.trim().split("\n");
    expect(lines[0]).toStartWith("occurred_at,recorded_at,event_id,event_type");
    for (const s of [
      "H-PLOT1-01",
      "DB-0412",
      "two_phase",
      "malaxationMaxTempC",
      "2028-06-30",
      "ORD-77",
      "Gastronomia Rossi",
    ])
      expect(csv).toContain(s);
    expect(lines.length).toBeGreaterThan(8);
  });
});

describe("rules", () => {
  test("outputs heavier than inputs fail mass balance; operators cannot override; owners can with a reason", async () => {
    const r = await m.recordOk({
      type: "RECEIVE",
      occurredAt: hoursAgo(5),
      partnerId: m.partners.grower,
      outputs: [{ productId: m.products.olives, quantity: "100" }],
    });
    const body = {
      type: "TRANSFORM",
      process: "milling",
      occurredAt: hoursAgo(4),
      kdes: { extractionMethod: "two_phase", malaxationMaxTempC: 25 },
      inputs: [{ lotId: m.out(r), quantity: "100" }],
      outputs: [{ productId: m.products.oil, quantity: "150" }],
    };
    const res = await m.record(body);
    expect(res.status).toBe(422);
    expect(await res.text()).toContain("exceed inputs");

    const operator = await verifiedUser(app, "trace-op");
    await addMember(m.c, m.orgId, operator, "operator");
    const withOverride = { ...body, overrideMassBalance: { reason: "Scale at intake was broken" } };
    expect((await m.record(withOverride, operator.client)).status).toBe(403);
    const ok = await m.record(withOverride);
    expect(ok.status).toBe(201);
    expect((await json<Ev>(ok)).overrideReason).toBe("Scale at intake was broken");
  });

  test("a lot cannot be overdrawn, and concurrent use of the same stock records only one event", async () => {
    const r = await m.recordOk({
      type: "RECEIVE",
      occurredAt: hoursAgo(5),
      partnerId: m.partners.grower,
      outputs: [{ productId: m.products.olives, quantity: "50" }],
    });
    const lotId = m.out(r);
    const over = await m.record({
      type: "SHIP",
      occurredAt: hoursAgo(1),
      partnerId: m.partners.shop,
      inputs: [{ lotId, quantity: "50.000001" }],
    });
    expect(over.status).toBe(422);
    const ship = {
      type: "SHIP",
      occurredAt: hoursAgo(1),
      partnerId: m.partners.shop,
      inputs: [{ lotId, quantity: "40" }],
    };
    const results = await Promise.all([m.record(ship), m.record(ship), m.record(ship)]);
    expect(results.map((x) => x.status).sort()).toEqual([201, 422, 422]);
    expect((await m.lot(lotId)).quantity).toBe("10");
  });

  test("idempotency: a retried submission is recorded once; a reused key with other content is refused", async () => {
    const body = {
      type: "ORIGINATE",
      process: "harvest",
      occurredAt: hoursAgo(3),
      locationId: m.locations.plot,
      kdes: { cultivars: ["Coratina"] },
      outputs: [{ productId: m.products.olives, quantity: "321" }],
      idempotencyKey: `phone-${crypto.randomUUID()}`,
    };
    const first = await m.record(body);
    const again = await m.record(body);
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect((await json<Ev>(again)).id).toBe((await json<Ev>(first)).id);
    expect(
      (await m.record({ ...body, outputs: [{ productId: m.products.olives, quantity: "322" }] })).status,
    ).toBe(409);
  });

  test("KDEs are validated per event type; a harvest needs a plot", async () => {
    const lot = await m.recordOk({
      type: "RECEIVE",
      occurredAt: hoursAgo(5),
      partnerId: m.partners.grower,
      outputs: [{ productId: m.products.olives, quantity: "10" }],
    });
    const noTemp = await m.record({
      type: "TRANSFORM",
      process: "milling",
      occurredAt: hoursAgo(1),
      kdes: { extractionMethod: "two_phase" },
      inputs: [{ lotId: m.out(lot), quantity: "10" }],
      outputs: [{ productId: m.products.oil, quantity: "1" }],
    });
    expect(noTemp.status).toBe(422);
    expect(await noTemp.text()).toContain("kdes.malaxationMaxTempC");
    const atMill = await m.record({
      type: "ORIGINATE",
      process: "harvest",
      occurredAt: hoursAgo(1),
      locationId: m.locations.mill,
      kdes: { cultivars: ["Coratina"] },
      outputs: [{ productId: m.products.olives, quantity: "1" }],
    });
    expect(atMill.status).toBe(422);
    const future = await m.record({
      type: "ORIGINATE",
      process: "harvest",
      occurredAt: new Date(Date.now() + 86_400_000).toISOString(),
      locationId: m.locations.plot,
      kdes: { cultivars: ["Coratina"] },
      outputs: [{ productId: m.products.olives, quantity: "1" }],
    });
    expect(future.status).toBe(422);
    const toSupplier = await m.record({
      type: "SHIP",
      occurredAt: hoursAgo(1),
      partnerId: m.partners.grower,
      inputs: [{ lotId: m.out(lot), quantity: "1" }],
    });
    expect(toSupplier.status).toBe(422);
  });

  test("a lot on hold cannot be used until released", async () => {
    const r = await m.recordOk({
      type: "RECEIVE",
      occurredAt: hoursAgo(5),
      partnerId: m.partners.grower,
      outputs: [{ productId: m.products.olives, quantity: "20" }],
    });
    const lotId = m.out(r);
    expect(
      (await m.c.call("POST", `${m.base}/lots/${lotId}/hold`, { reason: "Pesticide residue check pending" }))
        .status,
    ).toBe(200);
    const ship = {
      type: "SHIP",
      occurredAt: hoursAgo(1),
      partnerId: m.partners.shop,
      inputs: [{ lotId, quantity: "5" }],
    };
    const blocked = await m.record(ship);
    expect(blocked.status).toBe(422);
    expect(await blocked.text()).toContain("on hold");
    await m.c.call("POST", `${m.base}/lots/${lotId}/release`);
    expect((await m.record(ship)).status).toBe(201);
  });
});

describe("corrections (VOID)", () => {
  test("void + replacement: the current view is corrected, the original stays in the record, the lot code is reused", async () => {
    const wrong = await m.recordOk({
      type: "ORIGINATE",
      process: "harvest",
      occurredAt: hoursAgo(6),
      locationId: m.locations.plot,
      kdes: { cultivars: ["Coratina"] },
      outputs: [{ productId: m.products.olives, lotCode: "H-TYPO-01", quantity: "1200" }],
    });
    const res = await m.c.call("POST", `${m.base}/events/${wrong.id}/void`, {
      reason: "Typed 1200 instead of 1020",
      replacement: {
        type: "ORIGINATE",
        process: "harvest",
        occurredAt: hoursAgo(6),
        locationId: m.locations.plot,
        kdes: { cultivars: ["Coratina"] },
        outputs: [{ productId: m.products.olives, lotCode: "H-TYPO-01", quantity: "1020" }],
      },
    });
    expect(res.status).toBe(200);
    const { replacementEventId } = await json<{ replacementEventId: string }>(res);

    const original = await json<{ voidedBy: { reason: string } | null }>(
      await m.c.call("GET", `${m.base}/events/${wrong.id}`),
    );
    expect(original.voidedBy?.reason).toBe("Typed 1200 instead of 1020");
    expect(await m.lot(m.out(wrong))).toMatchObject({ status: "voided", lotCode: "H-TYPO-01" });
    const replacement = await json<Ev>(await m.c.call("GET", `${m.base}/events/${replacementEventId}`));
    expect(await m.lot(m.out(replacement))).toMatchObject({
      quantity: "1020",
      status: "active",
      lotCode: "H-TYPO-01",
    });

    const active = await json<{ items: Lot[] }>(await m.c.call("GET", `${m.base}/lots?q=H-TYPO-01`));
    expect(active.items.map((l) => l.quantity)).toEqual(["1020"]);
  });

  test("voiding a shipment restores stock; voiding an event whose outputs are used later is refused", async () => {
    const bottles = m.out(chain.bottling);
    const before = (await m.lot(bottles)).quantity;
    const ship = await m.recordOk({
      type: "SHIP",
      occurredAt: hoursAgo(1),
      partnerId: m.partners.shop,
      inputs: [{ lotId: bottles, quantity: "6" }],
    });
    expect(Number((await m.lot(bottles)).quantity)).toBe(Number(before) - 6);
    await m.c.call("POST", `${m.base}/events/${ship.id}/void`, { reason: "Order cancelled before loading" });
    expect((await m.lot(bottles)).quantity).toBe(before);

    const blocked = await m.c.call("POST", `${m.base}/events/${chain.milling.id}/void`, {
      reason: "Trying to void upstream",
    });
    expect(blocked.status).toBe(409);
    expect(await blocked.text()).toContain("Void them first");
    expect((await m.c.call("POST", `${m.base}/events/${ship.id}/void`, { reason: "Again" })).status).toBe(
      409,
    );
  });

  test("voided events disappear from traces", async () => {
    const r = await m.recordOk({
      type: "RECEIVE",
      occurredAt: hoursAgo(5),
      partnerId: m.partners.grower,
      outputs: [{ productId: m.products.olives, quantity: "30" }],
    });
    const mill = await m.recordOk({
      type: "TRANSFORM",
      process: "milling",
      occurredAt: hoursAgo(4),
      kdes: { extractionMethod: "press", malaxationMaxTempC: 24 },
      inputs: [{ lotId: m.out(r), quantity: "30" }],
      outputs: [{ productId: m.products.oil, quantity: "5" }],
    });
    await m.c.call("POST", `${m.base}/events/${mill.id}/void`, { reason: "Recorded on the wrong lot" });
    const t = await json<{ nodes: unknown[] }>(
      await m.c.call("GET", `${m.base}/lots/${m.out(r)}/trace?direction=forward`),
    );
    expect(t.nodes).toHaveLength(1);
    expect(await m.lot(m.out(r))).toMatchObject({ quantity: "30", status: "active" });
  });
});

describe("append-only storage", () => {
  test("the runtime role cannot update or delete events, lines or genealogy", async () => {
    const denied = /append-only|permission denied/;
    await expect(
      withTenant(db, m.orgId, (tx) =>
        tx.traceEvent.update({ where: { id: chain.harvest.id }, data: { note: "rewritten" } }),
      ),
    ).rejects.toThrow(denied);
    await expect(
      withTenant(
        db,
        m.orgId,
        (tx) =>
          tx.$executeRaw`UPDATE trace_event_line SET quantity = 1 WHERE event_id = ${chain.harvest.id}::uuid`,
      ),
    ).rejects.toThrow(denied);
    await expect(
      withTenant(
        db,
        m.orgId,
        (tx) => tx.$executeRaw`DELETE FROM lot_edge WHERE event_id = ${chain.milling.id}::uuid`,
      ),
    ).rejects.toThrow(denied);
  });

  test("another organisation cannot see or trace these lots", async () => {
    const other = await verifiedUser(app, "trace-other");
    const otherOrg = await createOrg(other.client, "Other mill");
    expect(
      (await other.client.call("GET", `/api/v1/orgs/${otherOrg}/lots/${m.out(chain.harvest)}`)).status,
    ).toBe(404);
    expect(
      (await other.client.call("GET", `/api/v1/orgs/${otherOrg}/lots/${m.out(chain.harvest)}/trace`)).status,
    ).toBe(404);
    expect(await withTenant(db, otherOrg, (tx) => tx.lotEdge.count({ where: { orgId: m.orgId } }))).toBe(0);
  });

  test("evidence can be linked to a lot", async () => {
    const form = new FormData();
    form.append("file", new File(["Lab: acidity 0.21 %, peroxides 6.1\n"], "lab.txt"));
    form.append(
      "metadata",
      JSON.stringify({
        type: "lab_report",
        title: "Lab OIL-26-001",
        links: [{ targetType: "lot", targetId: m.out(chain.milling) }],
      }),
    );
    const res = await m.c.call("POST", `${m.base}/evidence`, form);
    expect(res.status).toBe(201);
    expect(JSON.stringify(await res.json())).toContain("Lot OIL-26-001");
  });
});
