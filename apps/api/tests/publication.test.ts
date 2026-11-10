import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import path from "node:path";
import { PassportSnapshot } from "@casitrace/contracts";
import { createClamavScanner } from "../../worker/src/evidence/clamav";
import { createScanHandler } from "../../worker/src/evidence/scan-handler";
import { createSigner, generateKeyPkcs8 } from "../src/modules/publication/domain/signing";
import { withTenant } from "../src/platform/tenant";
import { addMember, type Client, client, createOrg, verifiedUser } from "./auth-helpers";
import { buildApp, db, env, signer, storage } from "./helpers";

afterAll(() => db.$disconnect());
const app = buildApp();
const json = async <T = Record<string, unknown>>(res: Response) => (await res.json()) as T;
const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const anon = () => client(app);
const VERIFY_SCRIPT = path.resolve(import.meta.dir, "../../../scripts/verify-passport.mjs");

/** Strings that must never appear in anything public. */
const PRIVATE = [
  "Azienda Di Bari", // supplier name (supplierNames off by default)
  "Gastronomia Rossi", // customer
  "BA-0011223", // registration number
  "IT01234567890", // VAT
  "price 4.20", // internal note
  "Lab: peroxides", // non-certificate document
  "secret-grove-notes", // location address line
  "orders@mill.example", // partner email
];

let owner: Client;
let orgId = "";
let base = "";
let bottleLot = "";
let passportId = "";
let publicId = "";

beforeAll(async () => {
  const u = await verifiedUser(app, "pub-owner");
  owner = u.client;
  orgId = await createOrg(owner, "Frantoio Pubblico");
  base = `/api/v1/orgs/${orgId}`;
  const c = async (p: string, body: unknown) => {
    const r = await owner.call("POST", `${base}${p}`, body);
    if (r.status >= 300) throw new Error(`${p}: ${r.status} ${await r.text()}`);
    return (await r.json()) as { id: string; lines?: { role: string; lot: { id: string } }[] };
  };
  await owner.call("PUT", `${base}/profile`, {
    legalName: "Frantoio Pubblico S.r.l.",
    registrationNumber: "BA-0011223",
    vatNumber: "IT01234567890",
    countryCode: "IT",
    region: "Puglia",
    city: "Andria",
    businessRoles: ["mill", "bottler"],
    publicListing: true,
    description: "Family mill since 1952",
  });
  const olives = await c("/products", { sku: "OLV", name: "Olives", category: "olives", uomCode: "kg" });
  const oil = await c("/products", {
    sku: "EVO",
    name: "EVO bulk",
    category: "olive_oil_bulk",
    uomCode: "kg",
    attributes: { grade: "extra_virgin" },
    conversions: [{ fromUom: "l", toUom: "kg", factor: 0.916 }],
  });
  const bottle = await c("/products", {
    sku: "EVO-750",
    name: "Olio extravergine 750 ml",
    category: "olive_oil_packaged",
    uomCode: "unit",
    gtin: "8001234560041",
    originCountry: "IT",
    originRegion: "Puglia",
    attributes: {
      grade: "extra_virgin",
      netVolumeMl: 750,
      container: "glass",
      cultivars: ["Coratina"],
      organic: true,
    },
    conversions: [{ fromUom: "l", toUom: "kg", factor: 0.916 }],
  });
  const plot = await c("/locations", {
    code: "PLOT-1",
    name: "Grove",
    type: "plot",
    region: "Puglia",
    countryCode: "IT",
    latitude: 41.2335,
    longitude: 16.2885,
    addressLine1: "secret-grove-notes",
  });
  const supplier = await c("/partners", {
    name: "Azienda Di Bari",
    kind: "supplier",
    email: "orders@mill.example",
  });
  const shop = await c("/partners", { name: "Gastronomia Rossi", kind: "customer" });
  const harvest = await c("/events", {
    type: "ORIGINATE",
    process: "harvest",
    occurredAt: ago(72),
    locationId: plot.id,
    kdes: { cultivars: ["Coratina"] },
    outputs: [{ productId: olives.id, quantity: "600" }],
    note: "price 4.20 per kg",
  });
  const receipt = await c("/events", {
    type: "RECEIVE",
    occurredAt: ago(70),
    partnerId: supplier.id,
    outputs: [{ productId: olives.id, quantity: "400" }],
  });
  const out = (e: { lines?: { role: string; lot: { id: string } }[] }) =>
    e.lines?.find((l) => l.role === "output")?.lot.id ?? "";
  const milling = await c("/events", {
    type: "TRANSFORM",
    process: "milling",
    occurredAt: ago(60),
    kdes: { extractionMethod: "two_phase", malaxationMaxTempC: 25 },
    inputs: [
      { lotId: out(harvest), quantity: "600" },
      { lotId: out(receipt), quantity: "400" },
    ],
    outputs: [{ productId: oil.id, quantity: "160" }],
  });
  const bottling = await c("/events", {
    type: "TRANSFORM",
    process: "bottling",
    occurredAt: ago(40),
    kdes: { bestBefore: "2028-06-30" },
    inputs: [{ lotId: out(milling), quantity: "100" }],
    outputs: [{ productId: bottle.id, lotCode: "B750-PUB-1", quantity: "145" }],
  });
  bottleLot = out(bottling);
  await c("/events", {
    type: "SHIP",
    occurredAt: ago(10),
    partnerId: shop.id,
    inputs: [{ lotId: bottleLot, quantity: "45" }],
  });

  // A certificate (public) and a lab report (never public), both linked to the lot.
  const upload = async (meta: Record<string, unknown>, body: string) => {
    const form = new FormData();
    form.append("file", new File([body], "doc.txt"));
    form.append("metadata", JSON.stringify(meta));
    return json<{ id: string }>(await owner.call("POST", `${base}/evidence`, form));
  };
  await upload(
    {
      type: "certificate",
      title: "EU organic certificate",
      scheme: "EU organic",
      issuerName: "ICEA",
      validUntil: "2027-12-31",
      links: [{ targetType: "lot", targetId: bottleLot }],
    },
    "certificate text",
  );
  await upload(
    { type: "lab_report", title: "Lab: peroxides 6.1", links: [{ targetType: "lot", targetId: bottleLot }] },
    "lab text",
  );
  const scan = createScanHandler(db, storage, createClamavScanner("localhost", 3310));
  for (const e of await db.outboxEvent.findMany({
    where: { type: "evidence.file_uploaded", publishedAt: null },
  })) {
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
  const p = await json<{ id: string; publicId: string }>(
    await owner.call("POST", `${base}/passports`, { scope: "lot", lotId: bottleLot }),
  );
  passportId = p.id;
  publicId = p.publicId;
});

describe("publishing", () => {
  test("a draft is not public; publishing creates signed version 1", async () => {
    expect((await anon().call("GET", `/api/v1/public/passports/${publicId}`)).status).toBe(404);
    const res = await owner.call("POST", `${base}/passports/${passportId}/publish`);
    expect(res.status).toBe(200);
    const p = await json<{
      status: string;
      currentVersion: number;
      qrPayload: string;
      versions: { keyId: string }[];
    }>(res);
    expect(p).toMatchObject({ status: "published", currentVersion: 1 });
    expect(p.qrPayload).toBe("http://localhost:5173/01/08001234560041/10/B750-PUB-1");
    expect(p.versions[0]?.keyId).toBe(signer.kid);
  });

  test("the public data matches the strict schema and the olive-oil facts", async () => {
    const pub = await json<{ snapshot: unknown; live: { recall: boolean; isLatest: boolean } }>(
      await anon().call("GET", `/api/v1/public/passports/${publicId}`),
    );
    const s = PassportSnapshot.parse(pub.snapshot);
    expect(s.product).toMatchObject({
      name: "Olio extravergine 750 ml",
      grade: "extra_virgin",
      netVolumeMl: 750,
      organicDeclared: true,
      gtin: "8001234560041",
    });
    expect(s.producer).toMatchObject({
      name: "Frantoio Pubblico",
      region: "Puglia",
      city: "Andria",
      verified: false,
    });
    expect(s.lot).toMatchObject({
      lotCode: "B750-PUB-1",
      bestBefore: "2028-06-30",
      milling: { extractionMethod: "two_phase", coldExtracted: true },
    });
    expect(s.lot?.originAreas).toEqual([
      { country: "IT", region: "Puglia", approxLat: 41.2, approxLon: 16.3 },
    ]);
    expect(s.journey.map((j) => j.step)).toEqual(["harvest", "receipt", "milling", "bottling"]);
    expect(s.certificates.map((c) => c.title)).toEqual(["EU organic certificate"]);
    expect(pub.live).toMatchObject({ recall: false, isLatest: true });
  });

  test("no private value appears in any public response (JSON, HTML, directory, organisation page)", async () => {
    const a = anon();
    const bodies = await Promise.all(
      [
        `/api/v1/public/passports/${publicId}`,
        `/api/v1/public/verify/${publicId}`,
        `/api/v1/public/p/${publicId}`,
        `/api/v1/public/p/${publicId}?lang=it`,
        "/api/v1/public/directory?q=Pubblico",
        `/api/v1/public/organisations/${orgId}`,
        `/api/v1/public/o/${orgId}`,
      ].map(async (u) => {
        const r = await a.call("GET", u);
        expect(r.status, u).toBe(200);
        return `${u}\n${await r.text()}`;
      }),
    );
    for (const body of bodies)
      for (const secret of PRIVATE)
        expect(body.includes(secret), `${secret} leaked in ${body.split("\n")[0]}`).toBe(false);
    // Quantities never appear: lot sizes 145, 600, 400, 160, 45 kg/units.
    const snapshot = JSON.stringify(
      (await json<{ snapshot: unknown }>(await a.call("GET", `/api/v1/public/passports/${publicId}`)))
        .snapshot,
    );
    for (const q of ['"145"', '"600"', '"400"', '"160"', '"45"', "quantity"])
      expect(snapshot.includes(q), q).toBe(false);
  });

  test("each disclosure switch removes its section", async () => {
    const off = {
      producerAddress: false,
      harvestDates: false,
      processDetails: false,
      originArea: false,
      certificates: false,
      supplierNames: false,
    };
    await owner.call("PUT", `${base}/passports/${passportId}/disclosure`, off);
    const s = PassportSnapshot.parse(
      await json(await owner.call("GET", `${base}/passports/${passportId}/preview`)),
    );
    expect(s.producer).toEqual({ name: "Frantoio Pubblico", verified: false });
    expect(s.lot?.harvest).toBeUndefined();
    expect(s.lot?.milling).toBeUndefined();
    expect(s.lot?.originAreas).toBeUndefined();
    expect(s.certificates).toEqual([]);
    expect(s.journey.every((j) => j.date === undefined)).toBe(true);
    // The producer's own steps carry its name (it is the producer); other organisations' names need supplierNames.
    expect(s.journey.every((j) => j.by === undefined || j.by === "Frantoio Pubblico")).toBe(true);
    await owner.call("PUT", `${base}/passports/${passportId}/disclosure`, {
      producerAddress: true,
      harvestDates: true,
      processDetails: true,
      originArea: true,
      certificates: true,
      supplierNames: false,
    });
  });
});

describe("verification", () => {
  test("an independent script verifies the signature using only the public key", async () => {
    const server = Bun.serve({ port: 0, fetch: app.fetch });
    try {
      const origin = `http://localhost:${server.port}`;
      // Asynchronous: the server runs in this process and must keep answering while the script runs.
      const run = async (...args: string[]) => {
        const proc = Bun.spawn(["node", VERIFY_SCRIPT, ...args], { stdout: "pipe", stderr: "pipe" });
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);
        return { stdout, stderr, exitCode };
      };
      const ok = await run(`${origin}/api/v1/public/passports/${publicId}`, `${origin}/api/v1/public/keys`);
      expect(ok.exitCode, ok.stdout + ok.stderr).toBe(0);
      expect(JSON.parse(ok.stdout)).toMatchObject({
        valid: true,
        checks: { signature: true, digest: true, canonicalForm: true },
      });

      // Tamper with one claim: the script refuses it.
      const doc = await json<{ canonical: string; snapshot: { product: { name: string } } }>(
        await fetch(`${origin}/api/v1/public/passports/${publicId}`),
      );
      const tampered = {
        ...doc,
        canonical: doc.canonical.replace("Olio extravergine", "Olio extravergine BIO DOP"),
        snapshot: {
          ...doc.snapshot,
          product: { ...doc.snapshot.product, name: "Olio extravergine BIO DOP 750 ml" },
        },
      };
      const file = path.join(process.env.TMPDIR ?? "/tmp", `tampered-${publicId}.json`);
      await Bun.write(file, JSON.stringify(tampered));
      const bad = await run(file, `${origin}/api/v1/public/keys`);
      expect(bad.exitCode).toBe(1);
      expect(JSON.parse(bad.stdout).checks.signature).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test("the verify endpoint reports validity and explains what a signature does not prove", async () => {
    const v = await json<{ valid: boolean; digestMatches: boolean; explanation: string }>(
      await anon().call("GET", `/api/v1/public/verify/${publicId}`),
    );
    expect(v).toMatchObject({ valid: true, digestMatches: true });
    expect(v.explanation).toContain("does not prove");
  });

  test("published versions are immutable; old versions still verify after a key rotation", async () => {
    const row = await withTenant(db, orgId, (tx) =>
      tx.passportVersion.findFirstOrThrow({ where: { passportId } }),
    );
    await expect(
      withTenant(db, orgId, (tx) =>
        tx.passportVersion.update({ where: { id: row.id }, data: { canonical: "{}" } }),
      ),
    ).rejects.toThrow(/append-only|permission denied/);

    const rotated = await createSigner(await generateKeyPkcs8(), [
      { kid: signer.kid, x: signer.publicKeys[0]?.x ?? "" },
    ]);
    const rotatedApp = buildApp({ publication: { signer: rotated, publicOrigin: env.WEB_ORIGIN } });
    expect(rotated.kid).not.toBe(signer.kid);
    const v1 = await json<{ valid: boolean; kid: string }>(
      await rotatedApp.request(`/api/v1/public/verify/${publicId}?version=1`),
    );
    expect(v1).toMatchObject({ valid: true, kid: signer.kid });
    const keys = await json<{ keys: { kid: string; status: string }[] }>(
      await rotatedApp.request("/api/v1/public/keys"),
    );
    expect(keys.keys.map((k) => k.status)).toEqual(["current", "previous"]);
  });

  test("republishing creates version 2; version 1 stays readable and is marked as not the latest", async () => {
    const p = await json<{ currentVersion: number }>(
      await owner.call("POST", `${base}/passports/${passportId}/publish`),
    );
    expect(p.currentVersion).toBe(2);
    const v1 = await json<{
      snapshot: { version: number };
      live: { isLatest: boolean; latestVersion: number };
    }>(await anon().call("GET", `/api/v1/public/passports/${publicId}?version=1`));
    expect(v1).toMatchObject({ snapshot: { version: 1 }, live: { isLatest: false, latestVersion: 2 } });
    const html = await (await anon().call("GET", `/api/v1/public/p/${publicId}?v=1`)).text();
    expect(html).toContain("older version");
  });
});

describe("QR and resolver", () => {
  test("the QR code encodes the GS1 Digital Link URL, which resolves to the page", async () => {
    const qr = await owner.call("GET", `${base}/passports/${passportId}/qr.svg`);
    expect(qr.headers.get("content-type")).toContain("image/svg+xml");
    expect(qr.headers.get("x-qr-payload")).toBe("http://localhost:5173/01/08001234560041/10/B750-PUB-1");
    expect(await qr.text()).toStartWith("<svg");
    const res = await anon().call("GET", "/api/v1/r/01/08001234560041/10/B750-PUB-1");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/p/${publicId}`);
    // Unknown lot of a known product falls back to the newest page for the GTIN.
    expect((await anon().call("GET", "/api/v1/r/01/08001234560041/10/UNKNOWN")).headers.get("location")).toBe(
      `/p/${publicId}`,
    );
    expect((await anon().call("GET", "/api/v1/r/01/00000000000000")).status).toBe(404);
  });
});

describe("public pages", () => {
  test("the HTML page needs no JavaScript and is translated", async () => {
    const en = await (await anon().call("GET", `/api/v1/public/p/${publicId}?lang=en`)).text();
    expect(en).not.toContain("<script");
    expect(en).toContain('<html lang="en">');
    for (const s of [
      "Olio extravergine 750 ml",
      "B750-PUB-1",
      "Cold extracted",
      "EU organic certificate",
      "Signature valid",
    ])
      expect(en).toContain(s);
    const it = await (
      await anon().call("GET", `/api/v1/public/p/${publicId}`, undefined, {
        "accept-language": "it-IT,it;q=0.9",
      })
    ).text();
    expect(it).toContain('<html lang="it">');
    expect(it).toContain("Estratto a freddo");
  });

  test("recall and withdrawal show banners; the signature stays valid", async () => {
    await withTenant(db, orgId, (tx) =>
      tx.lot.update({ where: { id: bottleLot }, data: { status: "recalled" } }),
    );
    expect(await (await anon().call("GET", `/api/v1/public/p/${publicId}`)).text()).toContain(
      "Product recall",
    );
    await withTenant(db, orgId, (tx) =>
      tx.lot.update({ where: { id: bottleLot }, data: { status: "active" } }),
    );
    await owner.call("POST", `${base}/passports/${passportId}/withdraw`);
    expect(await (await anon().call("GET", `/api/v1/public/p/${publicId}`)).text()).toContain("withdrawn");
    expect(
      await json<{ valid: boolean; status: string }>(
        await anon().call("GET", `/api/v1/public/verify/${publicId}`),
      ),
    ).toMatchObject({ valid: true, status: "withdrawn" });
  });

  test("the directory lists only organisations that opted in, needs a query and limits requests", async () => {
    const hidden = await verifiedUser(app, "pub-hidden");
    const hiddenOrg = await createOrg(hidden.client, "Frantoio Nascosto");
    await hidden.client.call("PUT", `/api/v1/orgs/${hiddenOrg}/profile`, {
      legalName: "Nascosto",
      countryCode: "IT",
      businessRoles: ["mill"],
    });
    const a = anon();
    const found = await json<{ items: { name: string }[] }>(
      await a.call("GET", "/api/v1/public/directory?q=Frantoio"),
    );
    expect(found.items.map((i) => i.name)).toContain("Frantoio Pubblico");
    expect(found.items.map((i) => i.name)).not.toContain("Frantoio Nascosto");
    expect((await a.call("GET", "/api/v1/public/directory?q=F")).status).toBe(422);
    expect((await a.call("GET", `/api/v1/public/organisations/${hiddenOrg}`)).status).toBe(404);
    const statuses: number[] = [];
    for (let i = 0; i < 32; i++)
      statuses.push((await a.call("GET", "/api/v1/public/directory?q=Frantoio")).status);
    expect(statuses).toContain(429);
  });

  test("viewers cannot publish; another organisation cannot see the passports", async () => {
    const viewer = await verifiedUser(app, "pub-viewer");
    await addMember(owner, orgId, viewer, "viewer");
    expect((await viewer.client.call("POST", `${base}/passports/${passportId}/publish`)).status).toBe(403);
    const other = await verifiedUser(app, "pub-other");
    const otherOrg = await createOrg(other.client, "Other");
    expect((await other.client.call("GET", `/api/v1/orgs/${otherOrg}/passports/${passportId}`)).status).toBe(
      404,
    );
  });
});
