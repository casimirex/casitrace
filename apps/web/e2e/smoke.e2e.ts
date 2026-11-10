import { expect, test } from "@playwright/test";

test("status page shows the API, database and storage as healthy", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "System status" })).toBeVisible();
  await expect(page.getByTestId("status-api")).toHaveText("ok");
  await expect(page.getByTestId("status-database")).toHaveText("ok");
  await expect(page.getByTestId("status-storage")).toHaveText("ok");
});
