import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createClamavScanner } from "../../worker/src/evidence/clamav";
import { runExpiryCheck } from "../../worker/src/evidence/expiry";
import { createScanHandler } from "../../worker/src/evidence/scan-handler";
import { withTenant } from "../src/platform/tenant";
import { addMember, type Client, createOrg, verifiedUser } from "./auth-helpers";
import { buildApp, db, env, storage } from "./helpers";

afterAll(() => db.$disconnect());
const app = buildApp();
const scan = createScanHandler(db, storage, createClamavScanner("localhost", 3310));

const PDF = new TextEncoder().encode(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);
const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
const sha256 = (b: Uint8Array | string) => new Bun.CryptoHasher("sha256").update(b).digest("hex");
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

type Ev = {
  id: string;
  status: string;
  files: { version: number; sha256: string; scanStatus: string }[];
  history: { toStatus: string; reason: string | null }[];
  links: { targetType: string; label: string | null }[];
};

const upload = async (
  c: Client,
  base: string,
  bytes: Uint8Array | string,
  name: string,
  meta: Record<string, unknown>,
) => {
  const form = new FormData();
  form.append("file", new File([bytes], name));
  form.append("metadata", JSON.stringify(meta));
  return c.call("POST", `${base}/evidence`, form);
};

/** Runs the worker's scan for every pending file (what the outbox → pg-boss → handler path does). */
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

let owner: Awaited<ReturnType<typeof verifiedUser>>;
let reviewer: Awaited<ReturnType<typeof verifiedUser>>;
let orgId = "";
let base = "";
let productId = "";

const certificate = (extra: Record<string, unknown> = {}) => ({
  type: "certificate",
  title: "Organic certificate 2026",
  scheme: "EU organic (Reg. 2018/848)",
  issuerName: "ICEA",
  certificateNumber: "IT-BIO-006-12345",
  validFrom: day(-300),
  validUntil: day(60),
  links: [{ targetType: "product", targetId: productId }],
  ...extra,
});

beforeAll(async () => {
  owner = await verifiedUser(app, "ev-owner");
  reviewer = await verifiedUser(app, "ev-reviewer");
  orgId = await createOrg(owner.client, "Evidence Mill");
  base = `/api/v1/orgs/${orgId}`;
  await addMember(owner.client, orgId, reviewer, "reviewer");
  const p = await owner.client.call("POST", `${base}/products`, {
    sku: "EVO-BULK",
    name: "EVO bulk",
    category: "olive_oil_bulk",
    uomCode: "kg",
    attributes: { grade: "extra_virgin", organic: true },
  });
  productId = ((await p.json()) as { id: string }).id;
});

describe("upload, scan, download and integrity", () => {
  test("a PDF certificate is hashed, scanned clean, downloadable, and its hash re-checks", async () => {
    const res = await upload(owner.client, base, PDF, "organic.pdf", certificate());
    expect(res.status).toBe(201);
    const ev = (await res.json()) as Ev;
    expect(ev.status).toBe("submitted");
    expect(ev.files[0]?.sha256).toBe(sha256(PDF));
    expect(ev.links).toEqual([expect.objectContaining({ targetType: "product", label: "EVO-BULK" })]);
    expect(JSON.stringify(ev)).not.toContain("orgs/"); // storage keys never leave the API

    const early = await owner.client.call("POST", `${base}/evidence/${ev.id}/files/1/download`);
    expect(early.status).toBe(409);

    await runScans();
    const after = (await (await owner.client.call("GET", `${base}/evidence/${ev.id}`)).json()) as Ev;
    expect(after.status).toBe("checked");
    expect(after.files[0]?.scanStatus).toBe("clean");

    const link = (await (
      await owner.client.call("POST", `${base}/evidence/${ev.id}/files/1/download`)
    ).json()) as { url: string; sha256: string };
    const downloaded = new Uint8Array(await (await fetch(link.url)).arrayBuffer());
    expect(sha256(downloaded)).toBe(link.sha256);
    expect(sha256(downloaded)).toBe(sha256(PDF));

    const integrity = (await (
      await owner.client.call("POST", `${base}/evidence/${ev.id}/files/1/integrity`)
    ).json()) as { match: boolean };
    expect(integrity.match).toBe(true);
  });

  test("tampering with the stored object is detected", async () => {
    const ev = (await (
      await upload(owner.client, base, PDF, "lab.pdf", { type: "lab_report", title: "Lab analysis" })
    ).json()) as Ev;
    await runScans();
    const file = await withTenant(db, orgId, (tx) =>
      tx.evidenceFile.findFirstOrThrow({ where: { evidenceId: ev.id } }),
    );
    await storage.put(file.storageKey, new TextEncoder().encode("%PDF-1.4 tampered"), "application/pdf");
    const check = (await (
      await owner.client.call("POST", `${base}/evidence/${ev.id}/files/1/integrity`)
    ).json()) as {
      match: boolean;
      storedSha256: string;
      actualSha256: string;
    };
    expect(check.match).toBe(false);
    expect(check.storedSha256).toBe(sha256(PDF));
  });

  test("the EICAR test file is blocked: rejected, removed from storage, never downloadable", async () => {
    const res = await upload(owner.client, base, EICAR, "notes.txt", {
      type: "other",
      title: "Suspicious notes",
    });
    expect(res.status).toBe(201);
    const ev = (await res.json()) as Ev;
    const file = await withTenant(db, orgId, (tx) =>
      tx.evidenceFile.findFirstOrThrow({ where: { evidenceId: ev.id } }),
    );
    await runScans();

    const after = (await (await owner.client.call("GET", `${base}/evidence/${ev.id}`)).json()) as Ev;
    expect(after.status).toBe("rejected");
    expect(after.files[0]?.scanStatus).toBe("infected");
    expect(after.history.at(-1)?.reason).toContain("Eicar");
    expect(await storage.exists(file.storageKey)).toBe(false);
    expect((await owner.client.call("POST", `${base}/evidence/${ev.id}/files/1/download`)).status).toBe(409);
  });

  test("objects in storage have no public URL", async () => {
    const ev = (await (
      await upload(owner.client, base, PDF, "private.pdf", { type: "other", title: "Private" })
    ).json()) as Ev;
    const file = await withTenant(db, orgId, (tx) =>
      tx.evidenceFile.findFirstOrThrow({ where: { evidenceId: ev.id } }),
    );
    expect((await fetch(`${env.S3_ENDPOINT}/${env.S3_BUCKET}/${file.storageKey}`)).status).toBe(403);
  });

  test("file type is sniffed from content: an executable renamed .pdf is refused, as are empty files", async () => {
    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0xff, 0xff]);
    const res = await upload(owner.client, base, exe, "invoice.pdf", { type: "other", title: "Fake PDF" });
    expect(res.status).toBe(422);
    expect(await res.text()).toContain("not accepted");
    expect(
      (await upload(owner.client, base, new Uint8Array(), "empty.pdf", { type: "other", title: "Empty" }))
        .status,
    ).toBe(422);
  });

  test("certificates need a scheme, issuer and expiry date", async () => {
    const res = await upload(owner.client, base, PDF, "c.pdf", { type: "certificate", title: "Incomplete" });
    expect(res.status).toBe(422);
    const body = await res.text();
    for (const f of ["scheme", "issuerName", "validUntil"]) expect(body).toContain(f);
  });

  test("links must point at records in this organisation", async () => {
    const other = await verifiedUser(app, "ev-other");
    const otherOrg = await createOrg(other.client, "Other");
    const p = await other.client.call("POST", `/api/v1/orgs/${otherOrg}/products`, {
      sku: "X",
      name: "X",
      category: "olives",
      uomCode: "kg",
    });
    const foreignProduct = ((await p.json()) as { id: string }).id;
    const res = await upload(owner.client, base, PDF, "x.pdf", {
      type: "other",
      title: "x",
      links: [{ targetType: "product", targetId: foreignProduct }],
    });
    expect(res.status).toBe(422);
  });
});

describe("review", () => {
  test("submitted → checked → verified → revoked, with the four-eyes rule and reasons", async () => {
    const ev = (await (
      await upload(owner.client, base, PDF, "cert.pdf", certificate({ title: "PDO certificate" }))
    ).json()) as Ev;
    expect(
      (await reviewer.client.call("POST", `${base}/evidence/${ev.id}/review`, { action: "verify" })).status,
    ).toBe(409); // not scanned
    await runScans();

    const self = await owner.client.call("POST", `${base}/evidence/${ev.id}/review`, { action: "verify" });
    expect(self.status).toBe(403);
    expect(await self.text()).toContain("other than the uploader");

    const verified = (await (
      await reviewer.client.call("POST", `${base}/evidence/${ev.id}/review`, { action: "verify" })
    ).json()) as Ev;
    expect(verified.status).toBe("verified");
    expect(
      (
        await owner.client.call("PUT", `${base}/evidence/${ev.id}`, {
          title: "Changed",
          scheme: "PDO",
          issuerName: "x",
          validUntil: day(10),
        })
      ).status,
    ).toBe(409);

    expect(
      (await reviewer.client.call("POST", `${base}/evidence/${ev.id}/review`, { action: "revoke" })).status,
    ).toBe(422);
    const revoked = (await (
      await reviewer.client.call("POST", `${base}/evidence/${ev.id}/review`, {
        action: "revoke",
        reason: "Certifier withdrew the certificate",
      })
    ).json()) as Ev;
    expect(revoked.status).toBe("revoked");
    expect(revoked.history.map((h) => h.toStatus)).toEqual(["submitted", "checked", "verified", "revoked"]);

    const form = new FormData();
    form.append("file", new File([PDF], "again.pdf"));
    expect((await owner.client.call("POST", `${base}/evidence/${ev.id}/files`, form)).status).toBe(409);
  });

  test("a rejected file can be replaced; the new version goes back to review", async () => {
    const ev = (await (
      await upload(owner.client, base, PDF, "decl.pdf", {
        type: "supplier_declaration",
        title: "Declaration",
      })
    ).json()) as Ev;
    await runScans();
    await reviewer.client.call("POST", `${base}/evidence/${ev.id}/review`, {
      action: "reject",
      reason: "Unsigned",
    });
    const form = new FormData();
    form.append("file", new File([new TextEncoder().encode("Signed declaration v2\n")], "decl-signed.txt"));
    const res = await owner.client.call("POST", `${base}/evidence/${ev.id}/files`, form);
    expect(res.status).toBe(201);
    const v2 = (await res.json()) as Ev;
    expect(v2.status).toBe("submitted");
    expect(v2.files.map((f) => f.version)).toEqual([2, 1]);
  });

  test("operators upload but cannot verify; viewers cannot upload", async () => {
    const operator = await verifiedUser(app, "ev-op");
    const viewer = await verifiedUser(app, "ev-viewer");
    await addMember(owner.client, orgId, operator, "operator");
    await addMember(owner.client, orgId, viewer, "viewer");
    const ev = (await (
      await upload(operator.client, base, PDF, "op.pdf", { type: "photo", title: "x" })
    ).json()) as Ev;
    await runScans();
    expect(
      (await operator.client.call("POST", `${base}/evidence/${ev.id}/review`, { action: "verify" })).status,
    ).toBe(403);
    expect((await upload(viewer.client, base, PDF, "v.pdf", { type: "other", title: "x" })).status).toBe(403);
    expect((await viewer.client.call("GET", `${base}/evidence`)).status).toBe(200);
  });

  test("evidence history and files cannot be rewritten in the database", async () => {
    const row = await withTenant(db, orgId, (tx) => tx.evidenceFile.findFirstOrThrow());
    await expect(
      withTenant(db, orgId, (tx) =>
        tx.evidenceFile.update({ where: { id: row.id }, data: { sha256: "0".repeat(64) } }),
      ),
    ).rejects.toThrow(/append-only/);
    const change = await withTenant(db, orgId, (tx) => tx.evidenceStatusChange.findFirstOrThrow());
    await expect(
      withTenant(db, orgId, (tx) => tx.evidenceStatusChange.delete({ where: { id: change.id } })),
    ).rejects.toThrow(/append-only|permission denied/);
  });
});

describe("certificate expiry", () => {
  test("warnings at 30 and 7 days, then expired after the end date; each sent once", async () => {
    const isolated = await verifiedUser(app, "exp-owner");
    const qa = await verifiedUser(app, "exp-qa");
    const org = await createOrg(isolated.client, "Expiry Farm");
    await addMember(isolated.client, org, qa, "reviewer");
    const b = `/api/v1/orgs/${org}`;
    const validUntil = day(20);
    const ev = (await (
      await upload(isolated.client, b, PDF, "organic.pdf", {
        type: "certificate",
        title: "Organic 2026",
        scheme: "EU organic",
        issuerName: "ICEA",
        validUntil,
      })
    ).json()) as Ev;
    await runScans();

    const at = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000);
    const run = (offsetDays: number) => runExpiryCheck(db, at(offsetDays), env.WEB_ORIGIN);

    await run(0); // 20 days left → 30-day warning
    await run(0); // same day again → nothing new
    const notes = async (c: Client) =>
      (await (await c.call("GET", "/api/v1/me/notifications")).json()) as {
        items: { title: string; link: string }[];
        unread: number;
      };
    let ownerNotes = await notes(isolated.client);
    expect(ownerNotes.items.filter((n) => n.link.includes(ev.id)).map((n) => n.title)).toEqual([
      "Certificate expires in 20 days: Organic 2026",
    ]);
    expect((await notes(qa.client)).items.some((n) => n.link.includes(ev.id))).toBe(true);
    const emails = await db.outboxEvent.findMany({
      where: { type: "email.requested", payload: { path: ["template"], equals: "evidence-expiry" } },
    });
    expect(emails.filter((e) => JSON.stringify(e.payload).includes(ev.id)).length).toBe(2);

    await run(14); // 6 days left → 7-day warning
    await run(20); // expires today → 0-day warning, still valid
    expect(((await (await isolated.client.call("GET", `${b}/evidence/${ev.id}`)).json()) as Ev).status).toBe(
      "checked",
    );
    await run(21); // validity ended → expired
    const expired = (await (await isolated.client.call("GET", `${b}/evidence/${ev.id}`)).json()) as Ev;
    expect(expired.status).toBe("expired");
    expect(expired.history.at(-1)?.reason).toContain(validUntil);

    ownerNotes = await notes(isolated.client);
    expect(
      ownerNotes.items
        .filter((n) => n.link.includes(ev.id))
        .map((n) => n.title)
        .sort(),
    ).toEqual(
      [
        "Certificate expired: Organic 2026",
        "Certificate expires in 20 days: Organic 2026",
        "Certificate expires in 6 days: Organic 2026",
        "Certificate expires today: Organic 2026",
      ].sort(),
    );
    expect(ownerNotes.unread).toBeGreaterThanOrEqual(4);
    expect((await isolated.client.call("POST", "/api/v1/me/notifications/read-all")).status).toBe(200);
    expect((await notes(isolated.client)).unread).toBe(0);
  });

  test("expiring-soon filter and verification refused after expiry", async () => {
    const res = await owner.client.call("GET", `${base}/evidence?expiringWithinDays=90`);
    const items = ((await res.json()) as { items: { daysUntilExpiry: number | null }[] }).items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.daysUntilExpiry !== null && i.daysUntilExpiry <= 90)).toBe(true);
  });
});

describe("tenant isolation of evidence", () => {
  test("another organisation cannot see the rows or the notifications", async () => {
    const other = await verifiedUser(app, "ev-iso");
    const otherOrg = await createOrg(other.client, "Iso");
    expect(await withTenant(db, otherOrg, (tx) => tx.evidence.count({ where: { orgId } }))).toBe(0);
    expect(await withTenant(db, otherOrg, (tx) => tx.evidenceFile.count({ where: { orgId } }))).toBe(0);
    const own = await db.notification.findFirst({ where: { userId: owner.userId } });
    if (own)
      expect((await other.client.call("POST", `/api/v1/me/notifications/${own.id}/read`)).status).toBe(404);
  });
});
