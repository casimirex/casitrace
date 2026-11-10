import { type Browser, expect, type Page, test } from "@playwright/test";
import { createOrganisation, signUpAndVerify } from "./helpers";

/** One company in its own browser: signed up, organisation created, with an API helper for set-up. */
const company = async (browser: Browser, person: string, name: string) => {
  const page = await (await browser.newContext()).newPage();
  await signUpAndVerify(page, person);
  await createOrganisation(page, name);
  const orgId = page.url().split("/orgs/")[1]?.split("/")[0] ?? "";
  const post = async (path: string, data: unknown) => {
    const res = await page.request.post(`/api/v1/orgs/${orgId}${path}`, { data });
    expect(res.status(), `${name} ${path}: ${await res.text()}`).toBeLessThan(300);
    return (await res.json()) as { id: string; lines?: { role: string; lot: { id: string } }[] };
  };
  return { page, orgId, post };
};
const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const out = (e: { lines?: { role: string; lot: { id: string } }[] }) =>
  e.lines?.find((l) => l.role === "output")?.lot.id ?? "";

const openTrace = async (page: Page, orgId: string, lotCode: string) => {
  await page.goto(`/orgs/${orgId}/lots`);
  await page.getByRole("link", { name: lotCode }).click();
  await expect(page.getByRole("img", { name: "Lot genealogy" })).toBeVisible();
};

test("grower → mill → retailer: shared history is visible, unshared parts are redacted, revoking hides them", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const grower = await company(browser, "Gina Grower", "Grove Di Bari");
  const mill = await company(browser, "Mario Miller", "Frantoio Centrale");
  const retailer = await company(browser, "Rita Retail", "Bottega Rossi");

  // Master data, linked partners.
  const gOlives = await grower.post("/products", {
    sku: "OLV",
    name: "Coratina olives",
    category: "olives",
    uomCode: "kg",
  });
  const gPlot = await grower.post("/locations", { code: "PLOT-1", name: "North grove", type: "plot" });
  const gToMill = await grower.post("/partners", {
    name: "Frantoio Centrale",
    kind: "customer",
    linkedOrgId: mill.orgId,
  });
  await mill.post("/products", { sku: "OLV-IN", name: "Olives intake", category: "olives", uomCode: "kg" });
  const mOil = await mill.post("/products", {
    sku: "EVO",
    name: "EVO bulk",
    category: "olive_oil_bulk",
    uomCode: "kg",
    attributes: { grade: "extra_virgin" },
  });
  await mill.post("/partners", { name: "Bottega Rossi", kind: "customer", linkedOrgId: retailer.orgId });
  await retailer.post("/products", {
    sku: "EVO-IN",
    name: "EVO from mill",
    category: "olive_oil_bulk",
    uomCode: "kg",
    attributes: { grade: "extra_virgin" },
  });

  // The grower harvests and ships to the mill without sharing.
  const harvest = await grower.post("/events", {
    type: "ORIGINATE",
    process: "harvest",
    occurredAt: ago(48),
    locationId: gPlot.id,
    kdes: { cultivars: ["Coratina"] },
    outputs: [{ productId: gOlives.id, lotCode: "H-GROVE-1", quantity: "1000" }],
  });
  await grower.post("/events", {
    type: "SHIP",
    occurredAt: ago(40),
    partnerId: gToMill.id,
    inputs: [{ lotId: out(harvest), quantity: "1000" }],
  });

  // The mill books the shipment in through the Shipments page.
  await mill.page.goto(`/orgs/${mill.orgId}/shipments`);
  const incoming = mill.page.getByRole("list", { name: "Incoming shipments" });
  await expect(incoming).toContainText("From Grove Di Bari");
  await incoming.getByLabel("Book H-GROVE-1 as").selectOption({ label: "OLV-IN · Olives intake" });
  await incoming.getByRole("button", { name: "Accept and book in" }).click();
  await expect(incoming).toContainText("Booked in as H-GROVE-1");

  // The mill mills and ships to the retailer, sharing the history (via the Ship form).
  const intake = await mill.page.request.get(`/api/v1/orgs/${mill.orgId}/lots?q=H-GROVE-1`);
  const intakeLot = ((await intake.json()) as { items: { id: string }[] }).items[0]?.id ?? "";
  await mill.post("/events", {
    type: "TRANSFORM",
    process: "milling",
    occurredAt: ago(30),
    kdes: { extractionMethod: "two_phase", malaxationMaxTempC: 26 },
    inputs: [{ lotId: intakeLot, quantity: "1000" }],
    outputs: [{ productId: mOil.id, lotCode: "OIL-C-1", quantity: "160" }],
  });
  await mill.page.goto(`/orgs/${mill.orgId}/record/ship`);
  await expect(mill.page.getByRole("heading", { name: "Ship" })).toBeVisible();
  await mill.page.getByLabel("To customer").selectOption({ label: "Bottega Rossi (on Casitrace)" });
  await expect(mill.page.getByText("They use Casitrace")).toBeVisible();
  await mill.page.getByLabel("Lot", { exact: true }).selectOption({ label: "OIL-C-1 · EVO bulk · 160 kg" });
  await mill.page.getByLabel("Quantity", { exact: true }).fill("100");
  await mill.page.getByRole("button", { name: "Record shipment" }).click();
  await expect(mill.page.getByText("Shipment of 100 recorded.")).toBeVisible();

  // The retailer accepts and traces backward: mill visible, grower redacted.
  await retailer.page.goto(`/orgs/${retailer.orgId}/shipments`);
  const rIncoming = retailer.page.getByRole("list", { name: "Incoming shipments" });
  await expect(rIncoming).toContainText("history shared with you");
  await rIncoming.getByRole("button", { name: "Accept and book in" }).click();
  await expect(rIncoming).toContainText("Booked in as OIL-C-1");
  await openTrace(retailer.page, retailer.orgId, "OIL-C-1");
  const table = retailer.page.getByRole("table", { name: "Trace" });
  await expect(table).toContainText("Frantoio Centrale");
  await expect(table).toContainText("Not shared by Grove Di Bari");
  await expect(retailer.page.getByTestId("redacted-node")).toHaveCount(1);

  // The grower shares with every downstream holder: the harvest appears.
  await grower.post("/grants", {
    granteeOrgId: null,
    lotId: out(harvest),
    upstreamDepth: 3,
    includeKdes: true,
  });
  await retailer.page.reload();
  await expect(table).toContainText("H-GROVE-1");
  await expect(retailer.page.getByTestId("redacted-node")).toHaveCount(0);

  // The mill stops sharing on its Sharing page: its part is hidden at once.
  await mill.page.goto(`/orgs/${mill.orgId}/sharing`);
  const shared = mill.page.getByRole("list", { name: "Shared by you" });
  await expect(shared).toContainText("Bottega Rossi");
  await shared.getByRole("button", { name: "Stop sharing" }).click();
  await expect(shared).toContainText("revoked");
  await retailer.page.reload();
  await expect(table).toContainText("Not shared by Frantoio Centrale");
  await expect(table).not.toContainText("H-GROVE-1");
});
