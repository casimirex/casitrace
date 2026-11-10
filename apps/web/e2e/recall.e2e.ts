import { expect, test } from "@playwright/test";
import { createOrganisation, signUpAndVerify } from "./helpers";

test("mock recall on pilot-like data is identified and exported well under 15 minutes; a real recall shows on the public page within a minute", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await signUpAndVerify(page, "Quinto Quality");
  await createOrganisation(page, `Frantoio Drill ${Date.now().toString(36)}`);
  const orgId = page.url().split("/orgs/")[1]?.split("/")[0] ?? "";
  type R = { id: string; publicId?: string; lines?: { role: string; lot: { id: string } }[] };
  const post = async (path: string, data: unknown): Promise<R> => {
    const res = await page.request.post(`/api/v1/orgs/${orgId}${path}`, { data });
    expect(res.status(), `${path}: ${await res.text()}`).toBeLessThan(300);
    return (await res.json()) as R;
  };
  const out = (e: R, i = 0) => e.lines?.filter((l) => l.role === "output")[i]?.lot.id ?? "";
  const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

  // Pilot-like chain: three grove harvests + a grower delivery → milling → two bottle sizes → four customers.
  const olives = await post("/products", { sku: "OLV", name: "Olives", category: "olives", uomCode: "kg" });
  const oil = await post("/products", {
    sku: "EVO",
    name: "EVO bulk",
    category: "olive_oil_bulk",
    uomCode: "kg",
    attributes: { grade: "extra_virgin" },
    conversions: [{ fromUom: "l", toUom: "kg", factor: 0.916 }],
  });
  const b500 = await post("/products", {
    sku: "EVO-500",
    name: "EVO 500 ml",
    category: "olive_oil_packaged",
    uomCode: "unit",
    attributes: { grade: "extra_virgin", netVolumeMl: 500, container: "glass" },
    conversions: [{ fromUom: "l", toUom: "kg", factor: 0.916 }],
  });
  const b750 = await post("/products", {
    sku: "EVO-750",
    name: "EVO 750 ml",
    category: "olive_oil_packaged",
    uomCode: "unit",
    attributes: { grade: "extra_virgin", netVolumeMl: 750, container: "glass" },
    conversions: [{ fromUom: "l", toUom: "kg", factor: 0.916 }],
  });
  const plots = await Promise.all(
    [1, 2, 3].map((i) => post("/locations", { code: `PLOT-${i}`, name: `Grove ${i}`, type: "plot" })),
  );
  const grower = await post("/partners", { name: "Azienda Di Bari", kind: "supplier" });
  const customers = await Promise.all(
    ["Enoteca Uno", "Bottega Due", "Ristorante Tre", "Mercato Quattro"].map((n, i) =>
      post("/partners", { name: n, kind: "customer", email: `c${i}@shop.example` }),
    ),
  );
  const harvests = await Promise.all(
    plots.map((p, i) =>
      post("/events", {
        type: "ORIGINATE",
        process: "harvest",
        occurredAt: ago(100 - i),
        locationId: p.id,
        kdes: { cultivars: ["Coratina"] },
        outputs: [{ productId: olives.id, quantity: "800" }],
      }),
    ),
  );
  const receipt = await post("/events", {
    type: "RECEIVE",
    occurredAt: ago(95),
    partnerId: grower.id,
    kdes: { supplierLotCode: "DB-77" },
    outputs: [{ productId: olives.id, quantity: "1200" }],
  });
  const milling = await post("/events", {
    type: "TRANSFORM",
    process: "milling",
    occurredAt: ago(90),
    kdes: { extractionMethod: "two_phase", malaxationMaxTempC: 26 },
    inputs: [
      ...harvests.map((h) => ({ lotId: out(h), quantity: "800" })),
      { lotId: out(receipt), quantity: "1200" },
    ],
    outputs: [{ productId: oil.id, lotCode: "OIL-DRILL-1", quantity: "560" }],
  });
  const bottling = await post("/events", {
    type: "TRANSFORM",
    process: "bottling",
    occurredAt: ago(80),
    kdes: { bestBefore: "2028-03-31" },
    inputs: [{ lotId: out(milling), quantity: "400" }],
    outputs: [
      { productId: b500.id, lotCode: "B500-DRILL", quantity: "400" },
      { productId: b750.id, lotCode: "B750-DRILL", quantity: "290" },
    ],
  });
  for (const [i, c] of customers.entries()) {
    await post("/events", {
      type: "SHIP",
      occurredAt: ago(70 - i),
      partnerId: c.id,
      inputs: [{ lotId: out(bottling, i % 2), quantity: "60" }],
    });
  }
  const passport = await post("/passports", { scope: "lot", lotId: out(bottling, 0) });
  await post(`/passports/${passport.id}/publish`, {});

  // Mock recall from the oil lot, through the UI.
  await page.goto(`/orgs/${orgId}/lots/${out(milling)}`);
  await page.getByLabel("Recall reason").fill("Quarterly mock recall");
  await page.getByRole("button", { name: "Start mock recall" }).click();
  await expect(page.getByRole("heading", { name: /Mock recall DRILL-/ })).toBeVisible();
  await expect(page.getByRole("table", { name: "Affected lots" }).getByRole("row")).toHaveCount(3);
  await expect(page.getByRole("list", { name: "Customers" }).getByRole("listitem")).toHaveCount(4);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export impact and contact list (CSV)" }).click();
  expect((await download).suggestedFilename()).toMatch(/^DRILL-.*\.csv$/);
  await expect(page.getByTestId("recall-clock")).toContainText("Impact identified and exported in");
  const clock = (await page.getByTestId("recall-clock").textContent()) ?? "";
  console.log(`Mock recall: ${clock}`);
  const seconds = Number(/in ([\d.]+) s/.exec(clock)?.[1] ?? Number.NaN);
  expect(seconds).toBeLessThan(15 * 60);

  // A real recall: the public page of a bottle lot shows the recall notice within a minute.
  await page.goto(`/orgs/${orgId}/lots/${out(milling)}`);
  await page.getByLabel("Real recall").check();
  await page.getByLabel("Recall reason").fill("Peroxide value above the legal limit");
  await page.getByLabel("Instructions for customers").fill("Remove from sale");
  const started = Date.now();
  await page.getByRole("button", { name: "Start recall" }).click();
  await expect(page.getByRole("heading", { name: /^Recall RC-/ })).toBeVisible();
  const consumer = await (await browser.newContext({ javaScriptEnabled: false })).newPage();
  await consumer.goto(`/p/${passport.publicId}`);
  await expect(consumer.getByRole("alert")).toContainText("Product recall");
  const bannerMs = Date.now() - started;
  console.log(`Public recall banner visible ${bannerMs} ms after starting the recall`);
  expect(bannerMs).toBeLessThan(60_000);
});
