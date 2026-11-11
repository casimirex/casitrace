/**
 * Cross-organisation exchange (roadmap-v2 P6): grower → mill → retailer.
 * Traces cross organisations only where grants exist; elsewhere they show redacted nodes.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createClamavScanner } from "../../worker/src/evidence/clamav";
import { createScanHandler } from "../../worker/src/evidence/scan-handler";
import { createHandoffNotifier } from "../../worker/src/exchange/handoff-notify";
import {
  addMember,
  type Client,
  client,
  createOrg,
  lastEmail,
  PASSWORD,
  pathOf,
  signIn,
  signUp,
  verifiedUser,
} from "./auth-helpers";
import { buildApp, db, storage } from "./helpers";

afterAll(() => db.$disconnect());
const app = buildApp();
const json = async <T = Record<string, unknown>>(res: Response) => (await res.json()) as T;
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

interface Org {
  id: string;
  c: Client;
  userId: string;
  base: string;
  post: (path: string, body?: unknown) => Promise<Response>;
  get: (path: string) => Promise<Response>;
  create: (path: string, body: unknown) => Promise<string>;
}
const org = async (name: string): Promise<Org> => {
  const u = await verifiedUser(app, name.toLowerCase().replace(/\W/g, ""));
  const id = await createOrg(u.client, name);
  const base = `/api/v1/orgs/${id}`;
  const post = (path: string, body?: unknown) => u.client.call("POST", `${base}${path}`, body ?? {});
  const get = (path: string) => u.client.call("GET", `${base}${path}`);
  const create = async (path: string, body: unknown) => {
    const res = await post(path, body);
    if (res.status !== 201) throw new Error(`${name} ${path}: ${res.status} ${await res.text()}`);
    return ((await res.json()) as { id: string }).id;
  };
  return { id, c: u.client, userId: u.userId, base, post, get, create };
};
const out = (e: { lines: { role: string; lot: { id: string } }[] }) =>
  e.lines.find((l) => l.role === "output")?.lot.id ?? "";

type Trace = {
  nodes: {
    lotId: string;
    lotCode: string;
    depth: number;
    redacted: boolean;
    org: { id: string; name: string; verified: boolean };
    origin: unknown;
  }[];
  shipments: { partnerName: string }[];
};
type Handoff = {
  id: string;
  status: string;
  lines: { senderLotId: string; lotCode: string; quantity: string }[];
  sharedHistory: boolean;
  disputeReason: string | null;
};

let grower: Org;
let mill: Org;
let retailer: Org;
let outsider: Org;
const ids: Record<string, string> = {};

beforeAll(async () => {
  [grower, mill, retailer, outsider] = await Promise.all([
    org("Grower Di Bari"),
    org("Frantoio Andria"),
    org("Gastronomia Rossi"),
    org("Unrelated Co"),
  ]);
  // Grower
  ids.gOlives = await grower.create("/products", {
    sku: "OLV",
    name: "Coratina olives",
    category: "olives",
    uomCode: "kg",
  });
  ids.gPlot = await grower.create("/locations", { code: "PLOT-1", name: "North grove", type: "plot" });
  ids.gToMill = await grower.create("/partners", {
    name: "Frantoio Andria",
    kind: "customer",
    linkedOrgId: mill.id,
  });
  // Mill
  ids.mOlives = await mill.create("/products", {
    sku: "OLV-IN",
    name: "Olives (intake)",
    category: "olives",
    uomCode: "kg",
  });
  ids.mOil = await mill.create("/products", {
    sku: "EVO-BULK",
    name: "EVO bulk",
    category: "olive_oil_bulk",
    uomCode: "kg",
    attributes: { grade: "extra_virgin" },
    conversions: [{ fromUom: "l", toUom: "kg", factor: 0.916 }],
  });
  ids.mToRetail = await mill.create("/partners", {
    name: "Gastronomia Rossi",
    kind: "customer",
    linkedOrgId: retailer.id,
  });
  ids.mOtherCustomer = await mill.create("/partners", { name: "Secret Other Customer", kind: "customer" });
  // Retailer
  ids.rOil = await retailer.create("/products", {
    sku: "EVO-IN",
    name: "EVO from mill",
    category: "olive_oil_bulk",
    uomCode: "kg",
    attributes: { grade: "extra_virgin" },
  });
});

describe("grower → mill → retailer", () => {
  test("the grower ships to the mill; the mill sees an incoming shipment and books it in", async () => {
    const harvest = await json<{ lines: { role: string; lot: { id: string } }[] }>(
      await grower.post("/events", {
        type: "ORIGINATE",
        process: "harvest",
        occurredAt: hoursAgo(48),
        locationId: ids.gPlot,
        kdes: { cultivars: ["Coratina"] },
        outputs: [{ productId: ids.gOlives, lotCode: "H-G-1", quantity: "1000" }],
      }),
    );
    ids.gHarvestLot = out(harvest);
    const ship = await grower.post("/events", {
      type: "SHIP",
      occurredAt: hoursAgo(40),
      partnerId: ids.gToMill,
      kdes: { shipmentRef: "DDT-118" },
      inputs: [{ lotId: ids.gHarvestLot, quantity: "1000" }],
    });
    expect(ship.status).toBe(201);

    const incoming = await json<{ items: Handoff[] }>(await mill.get("/handoffs?direction=incoming"));
    expect(incoming.items).toHaveLength(1);
    const h = incoming.items[0] as Handoff;
    expect(h).toMatchObject({ status: "pending", sharedHistory: false });

    // The mill is told about the delivery (audit F-1): the worker's handler on the outbox event,
    // run twice to show it is idempotent.
    const evt = await db.outboxEvent.findFirstOrThrow({
      where: { type: "handoff.created", aggregateId: h.id },
    });
    expect(evt.orgId).toBe(mill.id);
    const notifyMill = createHandoffNotifier(db, "https://app.example");
    const relayed = {
      eventId: evt.id,
      type: evt.type,
      orgId: evt.orgId,
      aggregateType: evt.aggregateType,
      aggregateId: evt.aggregateId,
      payload: evt.payload,
      occurredAt: evt.occurredAt.toISOString(),
    };
    await notifyMill(relayed);
    await notifyMill(relayed);
    const notes = await json<{ items: { kind: string; title: string; link: string }[] }>(
      await mill.c.call("GET", "/api/v1/me/notifications"),
    );
    const delivery = notes.items.filter((n) => n.kind === "handoff.received");
    expect(delivery).toHaveLength(1);
    expect(delivery[0]?.title).toContain("Delivery from");
    expect(delivery[0]?.link).toBe(`/orgs/${mill.id}/shipments`);
    const emails = await db.outboxEvent.findMany({ where: { type: "email.requested", orgId: mill.id } });
    expect(
      emails.filter((e) =>
        JSON.stringify(e.payload).includes(`https://app.example/orgs/${mill.id}/shipments`),
      ),
    ).toHaveLength(1);
    // The grower (sender) gets nothing.
    const growerNotes = await json<{ items: { kind: string }[] }>(
      await grower.c.call("GET", "/api/v1/me/notifications"),
    );
    expect(growerNotes.items.some((n) => n.kind === "handoff.received")).toBe(false);
    expect(h.lines).toEqual([expect.objectContaining({ lotCode: "H-G-1", quantity: "1000" })]);
    ids.h1 = h.id;

    const accepted = await mill.post(`/handoffs/${h.id}/accept`, {
      lines: [{ senderLotId: h.lines[0]?.senderLotId, productId: ids.mOlives }],
    });
    expect(accepted.status).toBe(200);
    const got = await json<{
      handoff: { status: string; receivedLots: { lotId: string; lotCode: string }[] };
    }>(accepted);
    expect(got.handoff.status).toBe("accepted");
    ids.mIntakeLot = got.handoff.receivedLots[0]?.lotId ?? "";
    // The mill got a partner record for the grower automatically.
    const partners = await json<{ items: { name: string; onPlatform: boolean }[] }>(
      await mill.get("/partners?kind=supplier"),
    );
    expect(partners.items).toEqual([expect.objectContaining({ name: "Grower Di Bari", onPlatform: true })]);
    // The grower can no longer void the shipment.
    const growerShip = await json<{ items: { id: string; type: string }[] }>(
      await grower.get("/events?type=SHIP"),
    );
    expect(
      (await grower.post(`/events/${growerShip.items[0]?.id}/void`, { reason: "Trying after acceptance" }))
        .status,
    ).toBe(409);
  });

  test("the mill mills, ships part to the retailer with its history shared, and part to another customer", async () => {
    const milling = await json<{ lines: { role: string; lot: { id: string } }[] }>(
      await mill.post("/events", {
        type: "TRANSFORM",
        process: "milling",
        occurredAt: hoursAgo(30),
        kdes: { extractionMethod: "two_phase", malaxationMaxTempC: 26 },
        inputs: [{ lotId: ids.mIntakeLot, quantity: "1000" }],
        outputs: [{ productId: ids.mOil, lotCode: "OIL-M-1", quantity: "160" }],
      }),
    );
    ids.mOilLot = out(milling);
    const toRetail = await mill.post("/events", {
      type: "SHIP",
      occurredAt: hoursAgo(20),
      partnerId: ids.mToRetail,
      kdes: { shipmentRef: "ORD-9" },
      inputs: [{ lotId: ids.mOilLot, quantity: "100" }],
      share: { upstreamDepth: 5, includeKdes: true },
    });
    expect(toRetail.status).toBe(201);
    await mill.post("/events", {
      type: "SHIP",
      occurredAt: hoursAgo(19),
      partnerId: ids.mOtherCustomer,
      inputs: [{ lotId: ids.mOilLot, quantity: "20" }],
    });

    const h = (await json<{ items: Handoff[] }>(await retailer.get("/handoffs?direction=incoming")))
      .items[0] as Handoff;
    expect(h.sharedHistory).toBe(true);
    const accepted = await json<{ handoff: { receivedLots: { lotId: string }[] } }>(
      await retailer.post(`/handoffs/${h.id}/accept`, {
        lines: [{ senderLotId: h.lines[0]?.senderLotId, productId: ids.rOil }],
      }),
    );
    ids.rLot = accepted.handoff.receivedLots[0]?.lotId ?? "";
  });

  test("the retailer's backward trace shows the mill's history and a redacted grower", async () => {
    const t = await json<Trace>(await retailer.get(`/lots/${ids.rLot}/trace?direction=backward`));
    const byDepth = t.nodes.map((n) => [n.depth, n.org.name, n.redacted, n.lotCode]);
    expect(byDepth).toEqual([
      [-3, "Grower Di Bari", true, ""],
      [-2, "Frantoio Andria", false, "H-G-1"],
      [-1, "Frantoio Andria", false, "OIL-M-1"],
      [0, "Gastronomia Rossi", false, "OIL-M-1"], // the retailer kept the lot code printed on the delivery
    ]);
    const redacted = t.nodes.find((n) => n.redacted);
    // Nothing of the grower's records leaks: not its lot ID, code, quantity or origin.
    expect(redacted?.lotId).not.toBe(ids.gHarvestLot);
    expect(JSON.stringify(t)).not.toContain(ids.gHarvestLot);
    expect(redacted?.origin).toBeNull();
    // The mill's other customer is not part of the retailer's (backward) view.
    expect(JSON.stringify(t)).not.toContain("Secret Other Customer");
  });

  test("the grower shares with every downstream holder: the retailer now sees the harvest", async () => {
    const g = await grower.post("/grants", {
      granteeOrgId: null,
      lotId: ids.gHarvestLot,
      upstreamDepth: 3,
      includeKdes: true,
    });
    expect(g.status).toBe(201);
    ids.gGrant = (await json<{ id: string }>(g)).id;
    const t = await json<Trace>(await retailer.get(`/lots/${ids.rLot}/trace?direction=backward`));
    expect(t.nodes.some((n) => n.redacted)).toBe(false);
    const harvest = t.nodes.find((n) => n.depth === -3);
    expect(harvest).toMatchObject({ lotCode: "H-G-1", org: { name: "Grower Di Bari" }, redacted: false });

    const report = await (await retailer.get(`/lots/${ids.rLot}/trace-report`)).text();
    expect(report.split("\n")[0]).toStartWith("organisation,");
    for (const s of ["Frantoio Andria", "malaxationMaxTempC", "Grower Di Bari", "Coratina"])
      expect(report).toContain(s);
    expect(report).not.toContain("Secret Other Customer");
    expect(report).not.toContain("NOT_SHARED");
  });

  test("every use of a grant is logged for both sides", async () => {
    const grants = await json<{
      given: { id: string; accessCount: number; grantee: { name: string } | null }[];
    }>(await mill.get("/grants"));
    const toRetail = grants.given.find((g) => g.grantee?.name === "Gastronomia Rossi");
    expect(toRetail?.accessCount).toBeGreaterThan(0);
    const log = await json<{ items: { action: string; granteeOrgId: string }[] }>(
      await mill.get(`/grants/${toRetail?.id}/access`),
    );
    expect(log.items.map((i) => i.action)).toEqual(expect.arrayContaining(["trace", "trace_report"]));
    expect(log.items.every((i) => i.granteeOrgId === retailer.id)).toBe(true);
  });

  test("revoking a grant takes effect immediately", async () => {
    const grants = await json<{ given: { id: string; grantee: { name: string } | null }[] }>(
      await mill.get("/grants"),
    );
    const g = grants.given.find((x) => x.grantee?.name === "Gastronomia Rossi");
    expect((await mill.post(`/grants/${g?.id}/revoke`)).status).toBe(200);
    const t = await json<Trace>(await retailer.get(`/lots/${ids.rLot}/trace?direction=backward`));
    expect(t.nodes.map((n) => [n.depth, n.org.name, n.redacted])).toEqual([
      [-1, "Frantoio Andria", true],
      [0, "Gastronomia Rossi", false],
    ]);
    // The mill's own records behind the shipment are hidden again (the shipped lot code itself was on
    // the delivery the retailer received, so it remains part of the retailer's own receipt).
    expect(JSON.stringify(t)).not.toContain(ids.mIntakeLot);
    expect(JSON.stringify(t)).not.toContain(ids.mOilLot);
    expect(JSON.stringify(t)).not.toContain("H-G-1");
    const report = await (await retailer.get(`/lots/${ids.rLot}/trace-report`)).text();
    expect(report).not.toContain("malaxationMaxTempC");
    expect(report).toContain("NOT_SHARED");
  });

  test("the mill's forward trace shows the retailer as redacted (the retailer shared nothing)", async () => {
    const t = await json<Trace>(await mill.get(`/lots/${ids.mOilLot}/trace?direction=forward`));
    const r = t.nodes.find((n) => n.org.name === "Gastronomia Rossi");
    expect(r).toMatchObject({ redacted: true, depth: 1 });
    expect(JSON.stringify(t)).not.toContain(ids.rLot);
    expect(t.shipments.map((s) => s.partnerName).sort()).toEqual([
      "Gastronomia Rossi",
      "Secret Other Customer",
    ]);
  });
});

describe("isolation of exchange data", () => {
  test("an unrelated organisation sees no handoffs, grants or shared data", async () => {
    expect((await json<{ items: unknown[] }>(await outsider.get("/handoffs"))).items).toEqual([]);
    expect((await outsider.get(`/handoffs/${ids.h1}`)).status).toBe(404);
    expect(
      (
        await outsider.post(`/handoffs/${ids.h1}/accept`, {
          lines: [{ senderLotId: ids.gHarvestLot, productId: ids.mOlives }],
        })
      ).status,
    ).toBe(404);
    const grants = await json<{ given: unknown[]; received: unknown[] }>(await outsider.get("/grants"));
    expect(grants).toEqual({ given: [], received: [] });
    // A grant "to every downstream holder" does not let an outsider trace the lot directly.
    expect((await outsider.get(`/lots/${ids.gHarvestLot}/trace`)).status).toBe(404);
  });

  test("the sender cannot accept its own shipment, and a grant cannot be revoked by the grantee", async () => {
    expect((await grower.post(`/handoffs/${ids.h1}/accept`, { lines: [] })).status).toBeGreaterThanOrEqual(
      400,
    );
    expect((await retailer.post(`/grants/${ids.gGrant}/revoke`)).status).toBe(404);
  });
});

describe("disputes", () => {
  test("the receiver disputes; the sender sees why, voids the shipment, and the handoff is cancelled", async () => {
    const lot = await json<{ lines: { role: string; lot: { id: string } }[] }>(
      await grower.post("/events", {
        type: "ORIGINATE",
        process: "harvest",
        occurredAt: hoursAgo(10),
        locationId: ids.gPlot,
        kdes: { cultivars: ["Coratina"] },
        outputs: [{ productId: ids.gOlives, quantity: "50" }],
      }),
    );
    const ship = await json<{ id: string }>(
      await grower.post("/events", {
        type: "SHIP",
        occurredAt: hoursAgo(9),
        partnerId: ids.gToMill,
        inputs: [{ lotId: out(lot), quantity: "50" }],
      }),
    );
    const h = (
      await json<{ items: Handoff[] }>(await mill.get("/handoffs?direction=incoming&status=pending"))
    ).items[0] as Handoff;
    expect((await mill.post(`/handoffs/${h.id}/dispute`, { reason: "Only 40 kg arrived" })).status).toBe(200);
    const seen = await json<Handoff>(await grower.get(`/handoffs/${h.id}`));
    expect(seen).toMatchObject({ status: "disputed", disputeReason: "Only 40 kg arrived" });

    expect(
      (await grower.post(`/events/${ship.id}/void`, { reason: "Re-sending with the correct weight" })).status,
    ).toBe(200);
    expect((await json<Handoff>(await mill.get(`/handoffs/${h.id}`))).status).toBe("cancelled");
    expect(
      (
        await mill.post(`/handoffs/${h.id}/accept`, {
          lines: [{ senderLotId: h.lines[0]?.senderLotId, productId: ids.mOlives }],
        })
      ).status,
    ).toBe(409);
  });
});

describe("evidence requests and supplier approval", () => {
  const PDF = new TextEncoder().encode(
    "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
  );
  const scan = createScanHandler(db, storage, createClamavScanner("localhost", 3310));
  const runScans = async () => {
    const events = await db.outboxEvent.findMany({
      where: { type: "evidence.file_uploaded", publishedAt: null },
    });
    for (const e of events) {
      await scan({
        eventId: e.id,
        type: e.type,
        orgId: e.orgId,
        aggregateType: e.aggregateType,
        aggregateId: e.aggregateId,
        payload: e.payload,
        occurredAt: e.occurredAt.toISOString(),
      });
      await db.outboxEvent.update({ where: { id: e.id }, data: { publishedAt: new Date() } });
    }
  };

  test("the mill requires an organic certificate; approval waits until the grower shares a verified one", async () => {
    const req = await mill.post("/supplier-requirements", {
      evidenceType: "certificate",
      scheme: "organic",
      label: "Organic certificate",
    });
    expect(req.status).toBe(201);
    const millPartners = await json<{ items: { id: string; name: string }[] }>(await mill.get("/partners"));
    const growerPartner = millPartners.items.find((p) => p.name === "Grower Di Bari")?.id ?? "";
    expect((await mill.post(`/partners/${growerPartner}/approve`)).status).toBe(409);

    const request = await json<{ id: string }>(
      await mill.post("/evidence-requests", {
        partnerId: growerPartner,
        evidenceType: "certificate",
        scheme: "EU organic",
        note: "Harvest 2026",
      }),
    );
    const incoming = await json<{
      items: { id: string; direction: string; counterparty: { name: string } }[];
    }>(await grower.get("/evidence-requests"));
    expect(incoming.items).toEqual([
      expect.objectContaining({
        id: request.id,
        direction: "incoming",
        counterparty: expect.objectContaining({ name: "Frantoio Andria" }),
      }),
    ]);
    const note = await db.notification.findFirst({
      where: { userId: grower.userId, kind: "evidence.requested" },
    });
    expect(note?.title).toContain("Frantoio Andria requests a certificate");

    // The grower uploads its certificate; a second person at the grower verifies it.
    const form = new FormData();
    form.append("file", new File([PDF], "organic.pdf"));
    form.append(
      "metadata",
      JSON.stringify({
        type: "certificate",
        title: "EU organic certificate 2026",
        scheme: "EU organic",
        issuerName: "ICEA",
        validUntil: "2027-12-31",
      }),
    );
    const ev = await json<{ id: string }>(await grower.c.call("POST", `${grower.base}/evidence`, form));
    await runScans();
    const qa = await verifiedUser(app, "grower-qa");
    await addMember(grower.c, grower.id, qa, "reviewer");
    expect(
      (await qa.client.call("POST", `${grower.base}/evidence/${ev.id}/review`, { action: "verify" })).status,
    ).toBe(200);

    expect((await grower.post(`/evidence-requests/${request.id}/fulfil`, { evidenceId: ev.id })).status).toBe(
      200,
    );
    const compliance = await json<{
      requirementsMet: boolean;
      requirements: { evidence: { source: string; status: string }[] }[];
    }>(await mill.get(`/partners/${growerPartner}/compliance`));
    expect(compliance.requirementsMet).toBe(true);
    expect(compliance.requirements[0]?.evidence).toEqual([
      expect.objectContaining({ source: "shared_by_supplier", status: "verified" }),
    ]);
    expect((await mill.post(`/partners/${growerPartner}/approve`)).status).toBe(200);

    // The mill can read and download the shared certificate; the grower sees the access.
    const shared = await json<{ title: string; sharedBy: { name: string }; links: unknown[] }>(
      await mill.get(`/shared/evidence/${ev.id}`),
    );
    expect(shared).toMatchObject({
      title: "EU organic certificate 2026",
      sharedBy: { name: "Grower Di Bari" },
      links: [],
    });
    const dl = await json<{ url: string }>(await mill.post(`/shared/evidence/${ev.id}/files/1/download`));
    expect((await fetch(dl.url)).status).toBe(200);
    const growerGrants = await json<{ given: { kind: string; accessCount: number; id: string }[] }>(
      await grower.get("/grants"),
    );
    const evGrant = growerGrants.given.find((g) => g.kind === "evidence");
    expect(evGrant?.accessCount).toBeGreaterThanOrEqual(2);

    // The retailer (not a grantee) cannot read it; after revocation neither can the mill.
    expect((await retailer.get(`/shared/evidence/${ev.id}`)).status).toBe(404);
    await grower.post(`/grants/${evGrant?.id}/revoke`);
    expect((await mill.get(`/shared/evidence/${ev.id}`)).status).toBe(404);
    expect(
      (await json<{ requirementsMet: boolean }>(await mill.get(`/partners/${growerPartner}/compliance`)))
        .requirementsMet,
    ).toBe(false);
  });

  test("requests can only go to suppliers on Casitrace; the requester can cancel; the supplier can decline", async () => {
    expect(
      (await mill.post("/evidence-requests", { partnerId: ids.mOtherCustomer, evidenceType: "lab_report" }))
        .status,
    ).toBe(409);
    const millPartners = await json<{ items: { id: string; name: string }[] }>(await mill.get("/partners"));
    const growerPartner = millPartners.items.find((p) => p.name === "Grower Di Bari")?.id ?? "";
    const a = await json<{ id: string }>(
      await mill.post("/evidence-requests", { partnerId: growerPartner, evidenceType: "lab_report" }),
    );
    expect(
      (await grower.post(`/evidence-requests/${a.id}/decline`, { reason: "No lab analysis this season" }))
        .status,
    ).toBe(200);
    const b = await json<{ id: string }>(
      await mill.post("/evidence-requests", { partnerId: growerPartner, evidenceType: "inspection_report" }),
    );
    expect((await mill.post(`/evidence-requests/${b.id}/cancel`)).status).toBe(200);
    expect((await grower.post(`/evidence-requests/${b.id}/fulfil`, { evidenceId: b.id })).status).toBe(409);
  });
});

describe("claiming an off-platform partner", () => {
  test("an external customer joins, links its organisation, and finds earlier shipments waiting", async () => {
    const shopPartner = await grower.create("/partners", { name: "Bottega Verdi", kind: "customer" });
    const lot = await json<{ lines: { role: string; lot: { id: string } }[] }>(
      await grower.post("/events", {
        type: "ORIGINATE",
        process: "harvest",
        occurredAt: hoursAgo(8),
        locationId: ids.gPlot,
        kdes: { cultivars: ["Coratina"] },
        outputs: [{ productId: ids.gOlives, quantity: "30" }],
      }),
    );
    await grower.post("/events", {
      type: "SHIP",
      occurredAt: hoursAgo(7),
      partnerId: shopPartner,
      inputs: [{ lotId: out(lot), quantity: "30" }],
    });

    const email = `verdi-${crypto.randomUUID()}@example.test`;
    expect((await grower.post(`/partners/${shopPartner}/claim-invite`, { email })).status).toBe(201);
    const mail = await lastEmail(email, "partner-claim");
    const token = pathOf(mail.data.url).split("/claim/")[1] ?? "";

    // Someone else cannot use the link.
    const intruder = await verifiedUser(app, "intruder");
    const intruderOrg = await createOrg(intruder.client, "Intruder");
    expect(
      (await intruder.client.call("POST", `/api/v1/claims/${token}/accept`, { organizationId: intruderOrg }))
        .status,
    ).toBe(403);

    // The invited person signs up with the invited address and links their new organisation.
    const shop = client(app);
    await signUp(shop, email, "Verdi Owner");
    await shop.call("GET", pathOf((await lastEmail(email, "verify-email")).data.url));
    if (!shop.cookies.size) await signIn(shop, email, PASSWORD);
    const shopOrg = await createOrg(shop, "Bottega Verdi");
    const info = await json<{ inviterName: string; partnerName: string }>(
      await shop.call("GET", `/api/v1/claims/${token}`),
    );
    expect(info).toMatchObject({ inviterName: "Grower Di Bari", partnerName: "Bottega Verdi" });
    const accepted = await shop.call("POST", `/api/v1/claims/${token}/accept`, { organizationId: shopOrg });
    expect(accepted.status).toBe(200);
    expect(await json(accepted)).toMatchObject({ shipmentsLinked: 1 });
    expect(
      (await shop.call("POST", `/api/v1/claims/${token}/accept`, { organizationId: shopOrg })).status,
    ).toBe(409);

    const waiting = await json<{ items: Handoff[] }>(
      await shop.call("GET", `/api/v1/orgs/${shopOrg}/handoffs?direction=incoming`),
    );
    expect(waiting.items).toEqual([expect.objectContaining({ status: "pending" })]);
    const growerPartners = await json<{ items: { name: string; onPlatform: boolean }[] }>(
      await grower.get("/partners"),
    );
    expect(growerPartners.items.find((p) => p.name === "Bottega Verdi")?.onPlatform).toBe(true);
  });
});
