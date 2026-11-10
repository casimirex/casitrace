import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { withTenant } from "../src/platform/tenant";
import { addMember, type Client, createOrg, verifiedUser } from "./auth-helpers";
import { buildApp, db } from "./helpers";

afterAll(() => db.$disconnect());
const app = buildApp();
const json = async <T = Record<string, unknown>>(res: Response) => (await res.json()) as T;
const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

interface Org {
  id: string;
  c: Client;
  userId: string;
  base: string;
  post: (path: string, body?: unknown) => Promise<Response>;
  get: (path: string) => Promise<Response>;
  ok: (
    path: string,
    body: unknown,
  ) => Promise<{ id: string; lines?: { role: string; lot: { id: string } }[]; publicId?: string }>;
}
const org = async (name: string): Promise<Org> => {
  const u = await verifiedUser(app, name.toLowerCase().replace(/\W/g, ""));
  const id = await createOrg(u.client, name);
  const base = `/api/v1/orgs/${id}`;
  const post = (path: string, body?: unknown) => u.client.call("POST", `${base}${path}`, body ?? {});
  const ok = async (path: string, body: unknown) => {
    const r = await post(path, body);
    if (r.status >= 300) throw new Error(`${name} ${path}: ${r.status} ${await r.text()}`);
    return r.json() as Promise<{
      id: string;
      lines?: { role: string; lot: { id: string } }[];
      publicId?: string;
    }>;
  };
  return {
    id,
    c: u.client,
    userId: u.userId,
    base,
    post,
    get: (path) => u.client.call("GET", `${base}${path}`),
    ok,
  };
};
const out = (e: { lines?: { role: string; lot: { id: string } }[] }) =>
  e.lines?.find((l) => l.role === "output")?.lot.id ?? "";

type Recall = {
  id: string;
  code: string;
  mode: string;
  secondsToExport: number | null;
  impact: {
    lots: { lotCode: string; org: { name: string }; redacted: boolean }[];
    customers: number;
    ownLotsFlagged: number;
    redactedOrganisations: string[];
  };
  notices: { id: string; partner: { name: string }; channel: string; acknowledgedAt: string | null }[];
};

let mill: Org;
let retailer: Org;
let outsider: Org;
const ids = { oilLot: "", bottleLot: "", retailerLot: "", publicId: "", drillId: "", realId: "" };

beforeAll(async () => {
  [mill, retailer, outsider] = await Promise.all([
    org("Frantoio Richiamo"),
    org("Enoteca Bianchi"),
    org("Nobody Co"),
  ]);
  const olives = await mill.ok("/products", {
    sku: "OLV",
    name: "Olives",
    category: "olives",
    uomCode: "kg",
  });
  const oil = await mill.ok("/products", {
    sku: "EVO",
    name: "EVO bulk",
    category: "olive_oil_bulk",
    uomCode: "kg",
    attributes: { grade: "extra_virgin" },
    conversions: [{ fromUom: "l", toUom: "kg", factor: 0.916 }],
  });
  const bottle = await mill.ok("/products", {
    sku: "EVO-500",
    name: "EVO 500 ml",
    category: "olive_oil_packaged",
    uomCode: "unit",
    gtin: "8001234560034",
    attributes: { grade: "extra_virgin", netVolumeMl: 500, container: "glass" },
    conversions: [{ fromUom: "l", toUom: "kg", factor: 0.916 }],
  });
  const plot = await mill.ok("/locations", { code: "P1", name: "Grove", type: "plot" });
  await mill.ok("/locations", { code: "WH", name: "Warehouse", type: "warehouse" });
  const toRetailer = await mill.ok("/partners", {
    name: "Enoteca Bianchi",
    kind: "customer",
    linkedOrgId: retailer.id,
  });
  const toShop = await mill.ok("/partners", {
    name: "Bottega Esterna",
    kind: "customer",
    email: "orders@esterna.example",
    city: "Bari",
    countryCode: "IT",
  });
  const harvest = await mill.ok("/events", {
    type: "ORIGINATE",
    process: "harvest",
    occurredAt: ago(80),
    locationId: plot.id,
    kdes: { cultivars: ["Coratina"] },
    outputs: [{ productId: olives.id, quantity: "1000" }],
  });
  const milling = await mill.ok("/events", {
    type: "TRANSFORM",
    process: "milling",
    occurredAt: ago(70),
    kdes: { extractionMethod: "two_phase", malaxationMaxTempC: 26 },
    inputs: [{ lotId: out(harvest), quantity: "1000" }],
    outputs: [{ productId: oil.id, lotCode: "OIL-RC-1", quantity: "160" }],
  });
  ids.oilLot = out(milling);
  const bottling = await mill.ok("/events", {
    type: "TRANSFORM",
    process: "bottling",
    occurredAt: ago(60),
    kdes: { bestBefore: "2028-01-31" },
    inputs: [{ lotId: ids.oilLot, quantity: "100" }],
    outputs: [{ productId: bottle.id, lotCode: "B500-RC-1", quantity: "200" }],
  });
  ids.bottleLot = out(bottling);
  await mill.ok("/events", {
    type: "SHIP",
    occurredAt: ago(50),
    partnerId: toRetailer.id,
    inputs: [{ lotId: ids.bottleLot, quantity: "120" }],
  });
  await mill.ok("/events", {
    type: "SHIP",
    occurredAt: ago(49),
    partnerId: toShop.id,
    inputs: [{ lotId: ids.bottleLot, quantity: "30" }],
  });

  // The retailer books its delivery in.
  const rProduct = await retailer.ok("/products", {
    sku: "EVO-500-IN",
    name: "EVO 500 ml (bought)",
    category: "olive_oil_packaged",
    uomCode: "unit",
    attributes: { grade: "extra_virgin", netVolumeMl: 500, container: "glass" },
  });
  const h = (
    await json<{ items: { id: string; lines: { senderLotId: string }[] }[] }>(
      await retailer.get("/handoffs?direction=incoming"),
    )
  ).items[0];
  const acc = await json<{ handoff: { receivedLots: { lotId: string }[] } }>(
    await retailer.post(`/handoffs/${h?.id}/accept`, {
      lines: [{ senderLotId: h?.lines[0]?.senderLotId, productId: rProduct.id }],
    }),
  );
  ids.retailerLot = acc.handoff.receivedLots[0]?.lotId ?? "";

  // A published public page for the bottle lot.
  const passport = await mill.ok("/passports", { scope: "lot", lotId: ids.bottleLot });
  await mill.ok(`/passports/${passport.id}/publish`, {});
  ids.publicId = passport.publicId ?? "";
});

describe("mock recall (drill)", () => {
  test("a reviewer runs a drill: impact found, customers listed, nothing outside the mill is touched, time recorded", async () => {
    const qa = await verifiedUser(app, "rc-qa");
    await addMember(mill.c, mill.id, qa, "reviewer");
    const startedAt = Date.now();
    const res = await qa.client.call("POST", `${mill.base}/recalls`, {
      mode: "drill",
      lotIds: [ids.oilLot],
      reason: "Quarterly mock recall",
      severity: "health_risk",
    });
    expect(res.status).toBe(201);
    const r = await json<Recall>(res);
    expect(r.code).toMatch(/^DRILL-\d{4}-\d{3}$/);
    expect(r.impact.lots.map((l) => [l.lotCode, l.org.name, l.redacted])).toEqual([
      ["OIL-RC-1", "Frantoio Richiamo", false],
      ["B500-RC-1", "Frantoio Richiamo", false],
      ["", "Enoteca Bianchi", true],
    ]);
    expect(r.impact).toMatchObject({
      customers: 2,
      ownLotsFlagged: 0,
      redactedOrganisations: ["Enoteca Bianchi"],
    });
    expect(r.notices.map((n) => [n.partner.name, n.channel]).sort()).toEqual([
      ["Bottega Esterna", "external"],
      ["Enoteca Bianchi", "external"],
    ]);

    // Nothing leaves the mill in a drill: no flags, no notice or notification at the retailer.
    expect(
      await withTenant(db, mill.id, (tx) => tx.lot.count({ where: { recallCaseId: { not: null } } })),
    ).toBe(0);
    expect((await json<{ items: unknown[] }>(await retailer.get("/recall-notices"))).items).toEqual([]);
    expect(await db.notification.count({ where: { orgId: retailer.id, kind: "recall.notice" } })).toBe(0);
    const pub = await json<{ live: { recall: boolean } }>(
      await app.request(`/api/v1/public/passports/${ids.publicId}`),
    );
    expect(pub.live.recall).toBe(false);
    const ship = await mill.post("/events", {
      type: "SHIP",
      occurredAt: ago(1),
      partnerId: (
        await json<{ items: { id: string; name: string }[] }>(await mill.get("/partners"))
      ).items.find((p) => p.name === "Bottega Esterna")?.id,
      inputs: [{ lotId: ids.bottleLot, quantity: "1" }],
    });
    expect(ship.status).toBe(201);

    // Export the impact: contact list included; the clock stops.
    const csv = await (await qa.client.call("GET", `${mill.base}/recalls/${r.id}/export`)).text();
    expect(csv).toContain("MOCK RECALL (DRILL)");
    for (const s of [
      "OIL-RC-1",
      "B500-RC-1",
      "not shared",
      "Bottega Esterna",
      "orders@esterna.example",
      "Bari",
    ])
      expect(csv).toContain(s);
    const after = await json<Recall>(await mill.get(`/recalls/${r.id}`));
    expect(after.secondsToExport).not.toBeNull();
    expect(after.secondsToExport ?? 1e9).toBeLessThan((Date.now() - startedAt) / 1000 + 1);
    expect(after.secondsToExport ?? 1e9).toBeLessThan(15 * 60);
    ids.drillId = r.id;
  });

  test("a reviewer cannot start or close a real recall", async () => {
    const qa = await verifiedUser(app, "rc-qa2");
    await addMember(mill.c, mill.id, qa, "reviewer");
    const res = await qa.client.call("POST", `${mill.base}/recalls`, {
      mode: "real",
      lotIds: [ids.oilLot],
      reason: "Not allowed",
      severity: "quality",
    });
    expect(res.status).toBe(403);
    expect(
      (await qa.client.call("POST", `${mill.base}/recalls/${ids.drillId}/close`, { note: "Drill done" }))
        .status,
    ).toBe(200);
  });
});

describe("real recall", () => {
  test("flags lots, blocks their use, shows the public banner at once, and notifies the customer on Casitrace", async () => {
    const res = await mill.post("/recalls", {
      mode: "real",
      lotIds: [ids.oilLot],
      reason: "Peroxide value above the legal limit in lab results",
      severity: "health_risk",
      instructions: "Remove from sale and return to the supplier.",
    });
    expect(res.status).toBe(201);
    const r = await json<Recall>(res);
    expect(r.code).toMatch(/^RC-\d{4}-\d{3}$/);
    expect(r.impact.ownLotsFlagged).toBe(2);
    ids.realId = r.id;

    const blocked = await mill.post("/events", {
      type: "SHIP",
      occurredAt: ago(1),
      partnerId: (
        await json<{ items: { id: string; name: string }[] }>(await mill.get("/partners"))
      ).items.find((p) => p.name === "Bottega Esterna")?.id,
      inputs: [{ lotId: ids.bottleLot, quantity: "1" }],
    });
    expect(blocked.status).toBe(422);
    expect(await blocked.text()).toContain("under recall");

    const html = await (await app.request(`/api/v1/public/p/${ids.publicId}`)).text();
    expect(html).toContain("Product recall");

    const notices = await json<{
      items: {
        id: string;
        caseCode: string;
        reason: string;
        yourLots: { lotId: string }[];
        instructions: string;
      }[];
    }>(await retailer.get("/recall-notices"));
    expect(notices.items).toHaveLength(1);
    expect(notices.items[0]).toMatchObject({
      caseCode: r.code,
      instructions: "Remove from sale and return to the supplier.",
    });
    expect(notices.items[0]?.yourLots.map((l) => l.lotId)).toEqual([ids.retailerLot]);
    const note = await db.notification.findFirst({ where: { orgId: retailer.id, kind: "recall.notice" } });
    expect(note?.title).toContain("Recall from Frantoio Richiamo");

    // The retailer acknowledges; the mill records the off-platform shop's confirmation and closes.
    expect(
      (
        await retailer.post(`/recall-notices/${notices.items[0]?.id}/acknowledge`, {
          note: "Removed 120 bottles from shelves",
        })
      ).status,
    ).toBe(200);
    const mid = await json<Recall>(await mill.get(`/recalls/${r.id}`));
    const shop = mid.notices.find((n) => n.partner.name === "Bottega Esterna");
    expect(mid.notices.find((n) => n.partner.name === "Enoteca Bianchi")?.acknowledgedAt).not.toBeNull();
    expect(
      (
        await mill.post(`/recalls/${r.id}/notices/${shop?.id}/acknowledge`, {
          note: "Confirmed by phone with the owner",
        })
      ).status,
    ).toBe(200);
    expect((await mill.post(`/recalls/${r.id}/close`, { note: "All customers confirmed" })).status).toBe(200);
    // Recalled product stays recalled publicly after the case is closed.
    expect(
      (
        await json<{ live: { recall: boolean } }>(
          await app.request(`/api/v1/public/passports/${ids.publicId}`),
        )
      ).live.recall,
    ).toBe(true);
  });

  test("when the retailer shares its downstream, a recall sees into its records", async () => {
    await retailer.ok("/grants", {
      granteeOrgId: mill.id,
      lotId: ids.retailerLot,
      upstreamDepth: 0,
      downstreamDepth: 5,
    });
    const r = await json<Recall>(
      await mill.post("/recalls", {
        mode: "drill",
        lotIds: [ids.oilLot],
        reason: "Drill after sharing",
        severity: "quality",
      }),
    );
    const retailerNode = r.impact.lots.find((l) => l.org.name === "Enoteca Bianchi");
    expect(retailerNode).toMatchObject({ redacted: false, lotCode: "B500-RC-1" });
    expect(r.impact.redactedOrganisations).toEqual([]);
  });
});

describe("isolation", () => {
  test("an unrelated organisation sees no recall or notice", async () => {
    expect((await outsider.get(`/recalls/${ids.realId}`)).status).toBe(404);
    expect((await json<{ items: unknown[] }>(await outsider.get("/recall-notices"))).items).toEqual([]);
    expect((await json<{ items: unknown[] }>(await outsider.get("/recalls"))).items).toEqual([]);
    const notice = (await json<{ items: { id: string }[] }>(await retailer.get("/recall-notices"))).items[0];
    expect(
      (await outsider.post(`/recall-notices/${notice?.id}/acknowledge`, { note: "Not mine" })).status,
    ).toBe(404);
  });
});
