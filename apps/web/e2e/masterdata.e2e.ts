import path from "node:path";
import { expect, test } from "@playwright/test";
import { createOrganisation, signUpAndVerify } from "./helpers";

const fixtures = path.resolve(import.meta.dirname, "../../api/tests/fixtures");

test("a mill sets up its profile, products (with a new version), a CSV import and a grove plot", async ({
  page,
}) => {
  await signUpAndVerify(page, "Marco Miller");
  await createOrganisation(page, "Frantoio Demo");

  await page.getByRole("link", { name: "Profile" }).click();
  await page.getByLabel("Legal name").fill("Frantoio Demo S.r.l.");
  await page.getByLabel("Country (ISO code)").fill("IT");
  await page.getByLabel("mill").check();
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Profile saved.")).toBeVisible();
  await expect(page.getByTestId("verification-status")).toHaveText("Not verified");

  await page.getByRole("link", { name: "Products" }).click();
  await page.getByLabel("SKU").fill("EVO-750");
  await page.getByLabel("Name").fill("Extra virgin olive oil 750 ml");
  await page.getByLabel("GTIN (barcode)").fill("8001234560041");
  await page.getByLabel("Cultivars").fill("Coratina");
  await page.getByRole("button", { name: "Create product" }).click();
  await expect(page.getByRole("heading", { name: "Extra virgin olive oil 750 ml" })).toBeVisible();
  await expect(page.getByText("1 unit = 0.75 l")).toBeVisible();

  await page.getByLabel("Name").fill("Extra virgin olive oil 750 ml — Coratina");
  await page.getByLabel("What changed").fill("Monovarietal label");
  await page.getByRole("button", { name: "Save as new version" }).click();
  await expect(page.getByText("Saved as version 2.")).toBeVisible();
  const versions = page.getByRole("list", { name: "Versions" });
  await expect(versions.getByRole("listitem")).toHaveCount(2);
  await expect(versions).toContainText("v1 · Extra virgin olive oil 750 ml");

  await page.getByRole("link", { name: "Import" }).click();
  await page.getByLabel("CSV file").setInputFiles(path.join(fixtures, "olive-mill-products.csv"));
  await page.getByRole("button", { name: "Import 8 row(s)" }).click();
  await expect(page.getByText("Imported: 8 created, 0 updated, 0 unchanged.")).toBeVisible();
  await page.getByRole("link", { name: "Products" }).click();
  await expect(page.getByRole("table", { name: "Products" }).getByRole("row")).toHaveCount(10); // header + 9

  await page.getByRole("link", { name: "Locations" }).click();
  await expect(page.getByRole("heading", { name: "Add a location" })).toBeVisible();
  await expect(page.getByText("No locations yet.")).toBeVisible();
  await page.getByLabel("Code", { exact: true }).fill("PLOT-N-01");
  await page.getByLabel("Name", { exact: true }).fill("North grove");
  await page.getByLabel("Type").selectOption("plot");
  await page
    .getByLabel("Boundary (GeoJSON)")
    .fill(
      '{"type":"Polygon","coordinates":[[[16.287,41.233],[16.29,41.233],[16.29,41.2345],[16.287,41.2345],[16.287,41.233]]]}',
    );
  await page.getByRole("button", { name: "Add location" }).click();
  const row = page.getByRole("table", { name: "Locations" }).getByRole("row", { name: /PLOT-N-01/ });
  await expect(row).toContainText(/4[.,]\d+ ha/);

  await page.getByLabel("Code", { exact: true }).fill("PLOT-BAD");
  await page.getByLabel("Name", { exact: true }).fill("Bad shape");
  await page
    .getByLabel("Boundary (GeoJSON)")
    .fill('{"type":"Polygon","coordinates":[[[0,0],[1,1],[1,0],[0,1],[0,0]]]}');
  await page.getByRole("button", { name: "Add location" }).click();
  await expect(page.getByText(/crosses itself/)).toBeVisible();
});
