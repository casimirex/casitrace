import { expect, type Page, test } from "@playwright/test";
import { createOrganisation, signUpAndVerify } from "./helpers";

/** Master data through the API (same browser session), so the test focuses on recording and tracing. */
const setup = async (page: Page) => {
  const orgId = page.url().split("/orgs/")[1]?.split("/")[0] ?? "";
  const post = async (path: string, data: unknown) => {
    const res = await page.request.post(`/api/v1/orgs/${orgId}${path}`, { data });
    expect(res.status(), `${path}: ${await res.text()}`).toBe(201);
  };
  await post("/products", { sku: "OLV", name: "Coratina olives", category: "olives", uomCode: "kg" });
  await post("/products", {
    sku: "EVO-BULK",
    name: "EVO bulk",
    category: "olive_oil_bulk",
    uomCode: "kg",
    attributes: { grade: "extra_virgin" },
    conversions: [{ fromUom: "l", toUom: "kg", factor: 0.916 }],
  });
  await post("/locations", { code: "PLOT-1", name: "North grove", type: "plot" });
  await post("/locations", { code: "MILL", name: "Mill", type: "facility" });
  await post("/partners", { name: "Azienda Di Bari", kind: "supplier" });
  await post("/partners", { name: "Gastronomia Rossi", kind: "customer" });
  return orgId;
};

test("harvest + receipt → milling → shipment, traced both ways, reported, corrected", async ({ page }) => {
  await signUpAndVerify(page, "Mill Operator");
  await createOrganisation(page, "Trace Demo Mill");
  const orgId = await setup(page);

  await page.goto(`/orgs/${orgId}/record/harvest`);
  await page.getByLabel("Quantity (kg)").fill("1000");
  await page.getByLabel("Cultivars").fill("Coratina");
  await page.getByLabel("Lot code (optional)").fill("H-001");
  await page.getByRole("button", { name: "Record harvest" }).click();
  await expect(page.getByText("Harvest of 1000 kg recorded.")).toBeVisible();

  await page.getByRole("link", { name: "Receive" }).click();
  await expect(page.getByRole("heading", { name: "Receive" })).toBeVisible();
  await page.getByLabel("Product").selectOption({ label: "OLV · Coratina olives (kg)" });
  await page.getByLabel("Quantity", { exact: true }).fill("2000");
  await page.getByLabel("Supplier's lot code").fill("DB-0412");
  await page.getByLabel("Our lot code (optional)").fill("R-001");
  await page.getByRole("button", { name: "Record receipt" }).click();
  await expect(page.getByText("Receipt of 2000 recorded.")).toBeVisible();

  await page.getByRole("link", { name: "Transform" }).click();
  await expect(page.getByRole("heading", { name: "Transform" })).toBeVisible();
  await page.getByLabel("Input lot 1").selectOption({ label: "H-001 · Coratina olives · 1000 kg" });
  await page.getByLabel("Input quantity 1").fill("1000");
  await page.getByRole("button", { name: "Add input" }).click();
  await page.getByLabel("Input lot 2").selectOption({ label: "R-001 · Coratina olives · 2000 kg" });
  await page.getByLabel("Input quantity 2").fill("2000");
  await page.getByLabel("Output product 1").selectOption({ label: "EVO-BULK · EVO bulk (kg)" });
  await page.getByLabel("Output quantity 1").fill("480");
  await page.getByLabel("Output lot code 1").fill("OIL-001");
  await page.getByLabel("Max malaxation temp (°C)").fill("26");
  await page.getByRole("button", { name: "Record transformation" }).click();
  await expect(page.getByText("Milling recorded.")).toBeVisible();

  await page.getByRole("link", { name: "Ship" }).click();
  await expect(page.getByRole("heading", { name: "Ship" })).toBeVisible();
  await page.getByLabel("Lot", { exact: true }).selectOption({ label: "OIL-001 · EVO bulk · 480 kg" });
  await page.getByLabel("Quantity", { exact: true }).fill("200");
  await page.getByLabel("Order / shipment reference").fill("ORD-77");
  await page.getByRole("button", { name: "Record shipment" }).click();
  await expect(page.getByText("Shipment of 200 recorded.")).toBeVisible();

  await page.getByRole("link", { name: "Lots" }).click();
  await page.getByRole("link", { name: "OIL-001" }).click();
  await expect(page.getByTestId("lot-quantity")).toContainText("280 kg");
  await expect(page.getByTestId("trace-summary")).toContainText(
    "3 lots · 1 supplier deliveries · 1 shipments",
  );
  const graph = page.getByRole("img", { name: "Lot genealogy" });
  await expect(graph).toContainText("Azienda Di Bari");
  await expect(graph).toContainText("Gastronomia Rossi");
  await expect(page.getByRole("list", { name: "Customers" })).toContainText("Gastronomia Rossi — 200 kg");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download trace report (CSV)" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("trace-OIL-001.csv");

  // Correct the shipment: void it with a reason; stock returns and the event stays, struck through.
  await page.getByLabel("Reason").fill("Order cancelled before loading");
  const shipEvent = page
    .getByRole("list", { name: "Events" })
    .getByRole("listitem")
    .filter({ hasText: "Shipped" });
  await shipEvent.getByRole("button", { name: "Void this event" }).click();
  await expect(page.getByTestId("lot-quantity")).toContainText("480 kg");
  await expect(shipEvent).toContainText("Voided: Order cancelled before loading");
});

test("a harvest recorded offline is kept on the device and sent when the connection returns", async ({
  page,
  context,
}) => {
  await signUpAndVerify(page, "Field Worker");
  await createOrganisation(page, "Offline Grove");
  const orgId = await setup(page);
  await page.goto(`/orgs/${orgId}/record/harvest`);
  await expect(page.getByLabel("Plot")).toContainText("PLOT-1");

  await context.setOffline(true);
  await page.getByLabel("Quantity (kg)").fill("750");
  await page.getByLabel("Cultivars").fill("Ogliarola");
  await page.getByLabel("Lot code (optional)").fill("H-OFFLINE-1");
  await page.getByRole("button", { name: "Record harvest" }).click();
  await expect(page.getByText(/No connection\. Harvest of 750 kg is saved on this device/)).toBeVisible();
  await expect(page.getByText("1 event(s) saved on this device")).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByText("1 event(s) saved on this device")).toHaveCount(0, { timeout: 10_000 });
  await page.getByRole("link", { name: "Lots" }).click();
  await expect(page.getByRole("link", { name: "H-OFFLINE-1" })).toBeVisible();
  // Sent exactly once.
  const lots = await page.request.get(`/api/v1/orgs/${orgId}/lots?q=H-OFFLINE-1`);
  expect(((await lots.json()) as { items: unknown[] }).items).toHaveLength(1);
});
