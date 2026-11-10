import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./helpers";
import { linkFromEmail, uniqueEmail } from "./mailpit";

test("register, verify, create an organisation, invite a colleague who joins as viewer", async ({
  browser,
}) => {
  const owner = await (await browser.newContext()).newPage();
  const ownerEmail = uniqueEmail("owner");
  await signUpAndVerify(owner, "Olive Grower", ownerEmail);
  await expect(owner.getByRole("heading", { name: /Welcome, Olive/ })).toBeVisible();

  await owner.getByLabel("Business name").fill("Hillside Olives");
  await owner.getByRole("button", { name: "Create organisation" }).click();
  await expect(owner.getByRole("heading", { name: "Hillside Olives" })).toBeVisible();
  await expect(owner.getByText("owner", { exact: true }).first()).toBeVisible();
  await expect(owner.getByRole("heading", { name: "Recent activity" })).toBeVisible();

  const colleagueEmail = uniqueEmail("colleague");
  await owner.getByRole("textbox", { name: "Email" }).fill(colleagueEmail);
  await owner.getByLabel("Role").selectOption("viewer");
  await owner.getByRole("button", { name: "Send invitation" }).click();
  await expect(owner.getByText(`Invitation sent to ${colleagueEmail}.`)).toBeVisible();

  const colleague = await (await browser.newContext()).newPage();
  await signUpAndVerify(colleague, "Cora Colleague", colleagueEmail);
  await colleague.goto(await linkFromEmail(colleagueEmail, /invited you to Hillside Olives/));
  await expect(colleague.getByText(/invited you to join/)).toBeVisible();
  await colleague.getByRole("button", { name: "Accept and join" }).click();

  await expect(colleague.getByRole("heading", { name: "Hillside Olives" })).toBeVisible();
  await expect(colleague.getByRole("list", { name: "Members" }).getByText("Olive Grower")).toBeVisible();
  // Viewers have no audit:read and cannot invite.
  await expect(colleague.getByRole("heading", { name: "Recent activity" })).toHaveCount(0);
  await expect(colleague.getByRole("button", { name: "Send invitation" })).toHaveCount(0);
});

test("forgotten password: reset by email, then sign in with the new password", async ({ page }) => {
  const email = uniqueEmail("forgetful");
  await signUpAndVerify(page, "Fern Forgetful", email);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await page.goto(await linkFromEmail(email, /Reset your Casitrace password/));
  const newPassword = "an entirely new passphrase";
  await page.getByLabel("New password").fill(newPassword);
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page.getByText("Password changed.")).toBeVisible();

  await page.getByRole("link", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(newPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /Welcome, Fern/ })).toBeVisible();
});

test("signed-out visitors are sent to sign in", async ({ page }) => {
  await page.goto("/account");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Faccount/);
});
