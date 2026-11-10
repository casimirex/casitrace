import { expect, type Page } from "@playwright/test";
import { linkFromEmail, uniqueEmail } from "./mailpit";

export const PASSWORD = "correct horse battery staple";

export const signUpAndVerify = async (page: Page, name: string, email = uniqueEmail("user")) => {
  await page.goto("/sign-up");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await page.goto(await linkFromEmail(email, /Confirm your email/));
  return email;
};

export const createOrganisation = async (page: Page, name: string) => {
  await page.getByLabel("Business name").fill(name);
  await page.getByRole("button", { name: "Create organisation" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
};
