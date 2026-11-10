import { expect, test } from "@playwright/test";
import { createOrganisation, signUpAndVerify } from "./helpers";

const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);
const EICAR = Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

test("a certificate is uploaded, scanned, integrity-checked, and shown on its product", async ({ page }) => {
  await signUpAndVerify(page, "Quality Lead");
  await createOrganisation(page, "Evidence Demo Mill");

  await page.getByRole("link", { name: "Products" }).click();
  await page.getByLabel("SKU").fill("EVO-500");
  await page.getByLabel("Name", { exact: true }).fill("EVO 500 ml");
  await page.getByRole("button", { name: "Create product" }).click();
  await expect(page.getByRole("heading", { name: "EVO 500 ml" })).toBeVisible();

  await page.getByRole("link", { name: "Evidence" }).click();
  await expect(page.getByRole("heading", { name: "Upload evidence" })).toBeVisible();
  await page
    .getByLabel("File")
    .setInputFiles({ name: "organic-2026.pdf", mimeType: "application/pdf", buffer: PDF });
  await page.getByLabel("Title").fill("Organic certificate 2026");
  await page.getByLabel("Scheme").fill("EU organic (Reg. 2018/848)");
  await page.getByLabel("Issued by").fill("ICEA");
  await page.getByLabel("Valid until").fill(inDays(200));
  await page.getByLabel("Product").selectOption({ label: "EVO-500 · EVO 500 ml" });
  await page.getByRole("button", { name: "Upload" }).click();

  await expect(page.getByRole("heading", { name: "Organic certificate 2026" })).toBeVisible();
  // The worker scans with ClamAV; the page refreshes until the status changes.
  await expect(page.getByTestId("status-meaning")).toContainText("passed the virus scan", {
    timeout: 30_000,
  });

  await page.getByRole("button", { name: "Check integrity" }).click();
  await expect(page.getByTestId("integrity-1")).toHaveText("Unchanged since upload");

  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("alert")).toContainText("other than the uploader");

  await page.getByRole("link", { name: "Products" }).click();
  await page.getByRole("link", { name: "EVO 500 ml" }).click();
  await expect(page.getByRole("link", { name: "Organic certificate 2026" })).toBeVisible();
});

test("a file carrying the EICAR test signature is rejected by the scan", async ({ page }) => {
  await signUpAndVerify(page, "Careless Uploader");
  await createOrganisation(page, "Scan Demo Mill");
  await page.getByRole("link", { name: "Evidence" }).click();
  await expect(page.getByRole("heading", { name: "Upload evidence" })).toBeVisible();
  await page.getByLabel("File").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: EICAR });
  await page.getByLabel("Kind of evidence").selectOption("other");
  await page.getByLabel("Title").fill("Field notes");
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByTestId("status-meaning")).toContainText("Rejected", { timeout: 30_000 });
  await expect(page.getByRole("list", { name: "History" })).toContainText("Virus scan failed");
  await expect(page.getByRole("button", { name: "Download" })).toHaveCount(0);
});
