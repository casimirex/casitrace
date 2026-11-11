import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import path from "node:path";
import { withTenant } from "../src/platform/tenant";
import { addMember, type Client, createOrg, PASSWORD, totpFor, verifiedUser } from "./auth-helpers";
import { buildApp, db } from "./helpers";

afterAll(() => db.$disconnect());
const app = buildApp();

const fixture = (name: string) => Bun.file(path.join(import.meta.dir, "fixtures", name)).text();
const json = async <T = Record<string, unknown>>(res: Response) => (await res.json()) as T;

let owner: Awaited<ReturnType<typeof verifiedUser>>;
let orgId = "";
let base = "";

beforeAll(async () => {
  owner = await verifiedUser(app, "mill-owner");
  orgId = await createOrg(owner.client, "Frantoio Andria");
  base = `/api/v1/orgs/${orgId}`;
});

const profile = {
  legalName: "Frantoio Andria S.r.l.",
  countryCode: "it",
  city: "Andria",
  businessRoles: ["mill", "bottler"],
};

const staffWithMfa = async () => {
  const staff = await verifiedUser(app, "verifier");
  await db.user.update({ where: { id: staff.userId }, data: { platformRole: "super_admin" } });
  const enable = await staff.client.call("POST", "/api/v1/auth/two-factor/enable", { password: PASSWORD });
  const totp = totpFor((await json<{ totpURI: string }>(enable)).totpURI);
  await staff.client.call("POST", "/api/v1/auth/two-factor/verify-totp", { code: totp.generate() });
  return staff.client;
};

describe("organisation profile and verification", () => {
  test("profile → verification request → approval; changing the legal name resets verification", async () => {
    const c = owner.client;
    const saved = await c.call("PUT", `${base}/profile`, profile);
    expect(saved.status).toBe(200);
    expect(await json(saved)).toMatchObject({ countryCode: "IT", verificationStatus: "unverified" });

    const noReg = await c.call("POST", `${base}/profile/verification-request`);
    expect(noReg.status).toBe(422);

    await c.call("PUT", `${base}/profile`, { ...profile, registrationNumber: "BA-0011223" });
    const req = await c.call("POST", `${base}/profile/verification-request`);
    expect((await json(req)).verificationStatus).toBe("pending");

    const staff = await staffWithMfa();
    const queue = await json<{ items: { orgId: string }[] }>(
      await staff.call("GET", "/api/v1/platform/verifications"),
    );
    expect(queue.items.map((p) => p.orgId)).toContain(orgId);
    const rejectWithoutNote = await staff.call("POST", `/api/v1/platform/verifications/${orgId}`, {
      decision: "reject",
    });
    expect(rejectWithoutNote.status).toBe(422);
    const approved = await staff.call("POST", `/api/v1/platform/verifications/${orgId}`, {
      decision: "approve",
      note: "Checked chamber of commerce record",
    });
    expect((await json(approved)).verificationStatus).toBe("verified");
    // The owner is told (audit F-3).
    const notes = await json<{ items: { kind: string; link: string }[] }>(
      await c.call("GET", "/api/v1/me/notifications"),
    );
    expect(notes.items).toContainEqual(
      expect.objectContaining({ kind: "organisation.verified", link: `/orgs/${orgId}/profile` }),
    );

    const renamed = await c.call("PUT", `${base}/profile`, {
      ...profile,
      registrationNumber: "BA-0011223",
      legalName: "Frantoio Nuovo S.r.l.",
    });
    expect((await json(renamed)).verificationStatus).toBe("unverified");

    const log = await json<{ items: { action: string; actorName: string }[] }>(
      await c.call("GET", `${base}/audit-log?limit=100`),
    );
    // Names instead of IDs (audit F-5): the owner by name, platform staff described, never named.
    const actor = (action: string) => log.items.find((i) => i.action === action)?.actorName;
    expect(actor("organisation.verification_requested")).toBe("mill-owner person");
    expect(actor("organisation.verified")).toBe("Casitrace staff");
    expect(log.items.map((i) => i.action)).toEqual(
      expect.arrayContaining([
        "organisation.profile_created",
        "organisation.verification_requested",
        "organisation.verified",
      ]),
    );
  });

  test("viewers cannot edit the profile", async () => {
    const viewer = await verifiedUser(app, "mill-viewer");
    await addMember(owner.client, orgId, viewer, "viewer");
    expect((await viewer.client.call("GET", `${base}/profile`)).status).toBe(200);
    expect((await viewer.client.call("PUT", `${base}/profile`, profile)).status).toBe(403);
  });
});

describe("locations", () => {
  const plot = {
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
  };

  test("a farm with a plot; the plot's area comes from its boundary", async () => {
    const farm = await json<{ id: string }>(
      await owner.client.call("POST", `${base}/locations`, {
        code: "FARM-1",
        name: "Masseria",
        type: "farm",
        countryCode: "IT",
      }),
    );
    const res = await owner.client.call("POST", `${base}/locations`, { ...plot, parentId: farm.id });
    expect(res.status).toBe(201);
    const created = await json<{ areaHa: number; parentId: string }>(res);
    expect(created.parentId).toBe(farm.id);
    expect(created.areaHa).toBeGreaterThan(4);
    expect(created.areaHa).toBeLessThan(4.5);

    const archiveParent = await owner.client.call("POST", `${base}/locations/${farm.id}/archive`);
    expect(archiveParent.status).toBe(409);
  });

  test("invalid geometry is rejected with the reason", async () => {
    const res = await owner.client.call("POST", `${base}/locations`, {
      ...plot,
      code: "PLOT-BAD",
      boundary: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [1, 1],
            [1, 0],
            [0, 1],
            [0, 0],
          ],
        ],
      },
    });
    expect(res.status).toBe(422);
    expect(JSON.stringify(await res.json())).toContain("crosses itself");
  });

  test("duplicate codes conflict; a location cannot be its own ancestor", async () => {
    expect(
      (await owner.client.call("POST", `${base}/locations`, { code: "PLOT-1", name: "Dup", type: "plot" }))
        .status,
    ).toBe(409);
    const a = await json<{ id: string }>(
      await owner.client.call("POST", `${base}/locations`, { code: "A", name: "A", type: "facility" }),
    );
    const b = await json<{ id: string }>(
      await owner.client.call("POST", `${base}/locations`, {
        code: "B",
        name: "B",
        type: "storage",
        parentId: a.id,
      }),
    );
    const cycle = await owner.client.call("PUT", `${base}/locations/${a.id}`, {
      code: "A",
      name: "A",
      type: "facility",
      parentId: b.id,
    });
    expect(cycle.status).toBe(422);
  });
});

describe("trading partners", () => {
  test("external and on-platform partners; self-links and duplicates are refused", async () => {
    const external = await owner.client.call("POST", `${base}/partners`, {
      name: "Azienda Di Bari",
      kind: "supplier",
      countryCode: "IT",
    });
    expect(await json(external)).toMatchObject({ onPlatform: false, linkedOrgId: null });

    const grower = await verifiedUser(app, "grower");
    const growerOrg = await createOrg(grower.client, "Grower Co");
    const linked = await owner.client.call("POST", `${base}/partners`, {
      name: "Grower Co",
      kind: "supplier",
      linkedOrgId: growerOrg,
    });
    expect(await json(linked)).toMatchObject({ onPlatform: true, linkedOrgName: "Grower Co" });
    expect(
      (
        await owner.client.call("POST", `${base}/partners`, {
          name: "Again",
          kind: "both",
          linkedOrgId: growerOrg,
        })
      ).status,
    ).toBe(409);
    expect(
      (await owner.client.call("POST", `${base}/partners`, { name: "Me", kind: "both", linkedOrgId: orgId }))
        .status,
    ).toBe(422);
    expect(
      (
        await owner.client.call("POST", `${base}/partners`, {
          name: "Ghost",
          kind: "both",
          linkedOrgId: "019a0000-0000-7000-8000-000000000000",
        })
      ).status,
    ).toBe(422);

    const suppliers = await json<{ items: { name: string }[] }>(
      await owner.client.call("GET", `${base}/partners?kind=supplier`),
    );
    expect(suppliers.items.map((p) => p.name)).toEqual(
      expect.arrayContaining(["Azienda Di Bari", "Grower Co"]),
    );
  });
});

describe("products and versions", () => {
  const bottle = {
    sku: "EVO-750",
    name: "Extra virgin olive oil 750 ml",
    category: "olive_oil_packaged",
    uomCode: "unit",
    gtin: "8001234560041",
    originCountry: "IT",
    attributes: { grade: "extra_virgin", netVolumeMl: 750, container: "glass", cultivars: ["Coratina"] },
    conversions: [{ fromUom: "l", toUom: "kg", factor: 0.916 }],
  };

  test("editing creates version 2; version 1 is preserved unchanged and cannot be altered", async () => {
    const created = await owner.client.call("POST", `${base}/products`, bottle);
    expect(created.status).toBe(201);
    const p = await json<{ id: string; currentVersion: number; current: { conversions: unknown[] } }>(
      created,
    );
    expect(p.currentVersion).toBe(1);
    expect(p.current.conversions).toEqual(
      expect.arrayContaining([
        { fromUom: "unit", toUom: "l", factor: 0.75 },
        { fromUom: "l", toUom: "kg", factor: 0.916 },
      ]),
    );

    const { sku: _sku, ...definition } = bottle;
    const same = await json<{ changed: boolean }>(
      await owner.client.call("POST", `${base}/products/${p.id}/versions`, definition),
    );
    expect(same.changed).toBe(false);

    const revised = await owner.client.call("POST", `${base}/products/${p.id}/versions`, {
      ...definition,
      name: "EVO 750 ml — Coratina",
      changeNote: "New label name",
    });
    const r = await json<{
      changed: boolean;
      product: { currentVersion: number; current: { name: string } };
    }>(revised);
    expect(r).toMatchObject({
      changed: true,
      product: { currentVersion: 2, current: { name: "EVO 750 ml — Coratina" } },
    });

    const v1 = await json<{ name: string; version: number }>(
      await owner.client.call("GET", `${base}/products/${p.id}/versions/1`),
    );
    expect(v1).toMatchObject({ version: 1, name: "Extra virgin olive oil 750 ml" });
    const history = await json<{ items: { version: number }[] }>(
      await owner.client.call("GET", `${base}/products/${p.id}/versions`),
    );
    expect(history.items.map((v) => v.version)).toEqual([2, 1]);

    const row = await withTenant(db, orgId, (tx) =>
      tx.productVersion.findFirstOrThrow({ where: { productId: p.id, version: 1 } }),
    );
    await expect(
      withTenant(db, orgId, (tx) =>
        tx.productVersion.update({ where: { id: row.id }, data: { name: "rewritten" } }),
      ),
    ).rejects.toThrow(/append-only|permission denied/);
  });

  test("GTINs are checked and unique within the organisation", async () => {
    const bad = await owner.client.call("POST", `${base}/products`, {
      ...bottle,
      sku: "BAD",
      gtin: "8001234560042",
    });
    expect(bad.status).toBe(422);
    const dup = await owner.client.call("POST", `${base}/products`, { ...bottle, sku: "DUP" });
    expect(dup.status).toBe(409);
    expect(JSON.stringify(await dup.json())).toContain("GTIN");
  });

  test("category rules: bulk oil needs a grade; a bottle is counted in units", async () => {
    const noGrade = await owner.client.call("POST", `${base}/products`, {
      sku: "BULK-X",
      name: "Bulk",
      category: "olive_oil_bulk",
      uomCode: "kg",
    });
    expect(noGrade.status).toBe(422);
    expect(JSON.stringify(await noGrade.json())).toContain("attributes.grade");
    const kgBottle = await owner.client.call("POST", `${base}/products`, {
      ...bottle,
      sku: "KG",
      gtin: null,
      uomCode: "kg",
    });
    expect(kgBottle.status).toBe(422);
  });

  test("archived products are hidden from the default list and cannot be revised", async () => {
    const p = await json<{ id: string }>(
      await owner.client.call("POST", `${base}/products`, {
        sku: "OLD",
        name: "Old olives",
        category: "olives",
        uomCode: "kg",
      }),
    );
    await owner.client.call("POST", `${base}/products/${p.id}/archive`);
    const list = await json<{ items: { sku: string }[] }>(await owner.client.call("GET", `${base}/products`));
    expect(list.items.map((i) => i.sku)).not.toContain("OLD");
    const revise = await owner.client.call("POST", `${base}/products/${p.id}/versions`, {
      name: "x",
      category: "olives",
      uomCode: "kg",
    });
    expect(revise.status).toBe(409);
  });
});

describe("CSV import", () => {
  let mill: Client;
  let millBase = "";
  beforeAll(async () => {
    const u = await verifiedUser(app, "importer");
    mill = u.client;
    millBase = `/api/v1/orgs/${await createOrg(mill, "Import Mill")}`;
  });

  test("an olive mill's product list: preview, import, re-import is a no-op, an edit becomes version 2", async () => {
    const csv = await fixture("olive-mill-products.csv");
    const preview = await json<{
      totalRows: number;
      validRows: number;
      rows: { action: string; errors: unknown[] }[];
    }>(await mill.call("POST", `${millBase}/imports/products/preview`, { csv }));
    expect(preview.rows.filter((r) => r.errors.length)).toEqual([]);
    expect(preview).toMatchObject({ totalRows: 8, validRows: 8 });
    expect(await db.product.count({ where: { sku: "EVO-5L-TIN", orgId: millBase.split("/").at(-1) } })).toBe(
      0,
    );

    const result = await json(await mill.call("POST", `${millBase}/imports/products`, { csv }));
    expect(result).toMatchObject({ created: 8, updated: 0, unchanged: 0 });

    const again = await json<{ rows: { action: string }[] }>(
      await mill.call("POST", `${millBase}/imports/products/preview`, { csv }),
    );
    expect(new Set(again.rows.map((r) => r.action))).toEqual(new Set(["unchanged"]));

    const edited = csv.replace("Extra virgin olive oil 5 l tin", "Extra virgin olive oil 5 l catering tin");
    expect(
      await json(await mill.call("POST", `${millBase}/imports/products`, { csv: edited })),
    ).toMatchObject({ created: 0, updated: 1, unchanged: 7 });
    const list = await json<{ items: { sku: string; currentVersion: number; name: string }[] }>(
      await mill.call("GET", `${millBase}/products`),
    );
    expect(list.items.find((p) => p.sku === "EVO-5L-TIN")).toMatchObject({
      currentVersion: 2,
      name: "Extra virgin olive oil 5 l catering tin",
    });
    expect(list.items.find((p) => p.sku === "EVO-750-GL")?.currentVersion).toBe(1);
  });

  test("a file with errors reports them per cell and imports nothing", async () => {
    const csv = [
      "sku,name,category,uom,gtin,grade,net_volume_ml,container,organic",
      "GOOD-1,Good olives,olives,kg,,,,,",
      "BAD-1,Bad bottle,olive_oil_packaged,unit,1234567890123,extra_virgin,750,glass,maybe",
      "BAD-2,Unknown,olive_juice,kg,,,,,",
      "GOOD-1,Duplicate,olives,kg,,,,,",
    ].join("\n");
    const preview = await json<{
      validRows: number;
      rows: { line: number; action: string; errors: { column: string }[] }[];
    }>(await mill.call("POST", `${millBase}/imports/products/preview`, { csv }));
    expect(preview.validRows).toBe(1);
    const cols = (line: number) =>
      preview.rows
        .find((r) => r.line === line)
        ?.errors.map((e) => e.column)
        .sort();
    expect(cols(3)).toEqual(["gtin", "organic"]);
    expect(cols(4)).toContain("category");
    expect(cols(5)).toEqual(["sku"]);

    const commit = await mill.call("POST", `${millBase}/imports/products`, { csv });
    expect(commit.status).toBe(422);
    const list = await json<{ items: { sku: string }[] }>(await mill.call("GET", `${millBase}/products`));
    expect(list.items.map((p) => p.sku)).not.toContain("GOOD-1");
  });

  test("locations with parent codes and plot polygons; partners", async () => {
    const loc = await json(
      await mill.call("POST", `${millBase}/imports/locations`, {
        csv: await fixture("olive-mill-locations.csv"),
      }),
    );
    expect(loc).toMatchObject({ created: 6 });
    const plots = await json<{ items: { code: string; parentId: string; areaHa: number }[] }>(
      await mill.call("GET", `${millBase}/locations?type=plot`),
    );
    expect(plots.items).toHaveLength(2);
    expect(plots.items.every((p) => p.parentId && p.areaHa > 0)).toBe(true);

    const partners = await json(
      await mill.call("POST", `${millBase}/imports/partners`, {
        csv: await fixture("olive-mill-partners.csv"),
      }),
    );
    expect(partners).toMatchObject({ created: 3 });
  });

  test("missing required columns are reported up front; the template lists the columns", async () => {
    const res = await mill.call("POST", `${millBase}/imports/locations/preview`, { csv: "code,name\nA,B" });
    expect(res.status).toBe(422);
    expect(JSON.stringify(await res.json())).toContain("type");
    const template = await mill.call("GET", `${millBase}/imports/partners/template`);
    expect(template.headers.get("content-type")).toContain("text/csv");
    expect(await template.text()).toStartWith("name,kind,");
  });

  test("operators may import; viewers may not", async () => {
    const operator = await verifiedUser(app, "imp-op");
    const viewer = await verifiedUser(app, "imp-viewer");
    const orgOfMill = millBase.split("/").at(-1) ?? "";
    const ownerOfMill = mill;
    await addMember(ownerOfMill, orgOfMill, operator, "operator");
    await addMember(ownerOfMill, orgOfMill, viewer, "viewer");
    const csv = "name,kind\nNew Customer,customer";
    expect((await operator.client.call("POST", `${millBase}/imports/partners/preview`, { csv })).status).toBe(
      200,
    );
    expect((await viewer.client.call("POST", `${millBase}/imports/partners/preview`, { csv })).status).toBe(
      403,
    );
    expect(
      (
        await operator.client.call(
          "POST",
          `${millBase}/locations/${"019a0000-0000-7000-8000-000000000000"}/archive`,
        )
      ).status,
    ).toBe(403);
  });
});

describe("row-level security on master data", () => {
  test("another organisation's scope cannot read or write this organisation's rows", async () => {
    const other = await verifiedUser(app, "rls-other");
    const otherOrg = await createOrg(other.client, "Other Org");
    const mine = await withTenant(db, orgId, (tx) => tx.product.count());
    expect(mine).toBeGreaterThan(0);
    expect(await withTenant(db, otherOrg, (tx) => tx.product.count({ where: { orgId } }))).toBe(0);
    expect(await withTenant(db, otherOrg, (tx) => tx.location.count({ where: { orgId } }))).toBe(0);
    expect(await db.product.count({ where: { orgId } })).toBe(0); // no scope at all
    await expect(
      withTenant(db, otherOrg, (tx) =>
        tx.location.create({
          data: { id: Bun.randomUUIDv7(), orgId, code: "X", name: "planted", type: "farm" },
        }),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});
