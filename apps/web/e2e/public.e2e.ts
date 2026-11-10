import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { createOrganisation, signUpAndVerify } from "./helpers";

test("publish a lot's public page; its QR link opens the page on a phone over 4G in under 2 s; it is accessible", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  await signUpAndVerify(page, "Paola Publisher");
  // Browser tests share the development database; a unique name keeps the directory search unambiguous.
  const orgName = `Frantoio Aperto ${Date.now().toString(36)}`;
  await createOrganisation(page, orgName);
  const orgId = page.url().split("/orgs/")[1]?.split("/")[0] ?? "";
  const post = async (path: string, data: unknown) => {
    const res = await page.request.fetch(`/api/v1/orgs/${orgId}${path}`, {
      method: path === "/profile" ? "PUT" : "POST",
      data,
    });
    expect(res.status(), await res.text()).toBeLessThan(300);
    return (await res.json()) as { id: string; lines?: { role: string; lot: { id: string } }[] };
  };
  await post("/profile", {
    legalName: "Frantoio Aperto S.r.l.",
    countryCode: "IT",
    region: "Puglia",
    city: "Bitonto",
    businessRoles: ["mill"],
    publicListing: true,
  });
  const olives = await post("/products", { sku: "OLV", name: "Olives", category: "olives", uomCode: "kg" });
  const bottle = await post("/products", {
    sku: "EVO-500",
    name: "Olio extravergine 500 ml",
    category: "olive_oil_packaged",
    uomCode: "unit",
    gtin: "8001234560034",
    originCountry: "IT",
    originRegion: "Puglia",
    attributes: { grade: "extra_virgin", netVolumeMl: 500, container: "glass", cultivars: ["Coratina"] },
    conversions: [{ fromUom: "l", toUom: "kg", factor: 0.916 }],
  });
  const plot = await post("/locations", {
    code: "P1",
    name: "Grove",
    type: "plot",
    region: "Puglia",
    countryCode: "IT",
    latitude: 41.1,
    longitude: 16.7,
  });
  const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
  const harvest = await post("/events", {
    type: "ORIGINATE",
    process: "harvest",
    occurredAt: ago(50),
    locationId: plot.id,
    kdes: { cultivars: ["Coratina"] },
    outputs: [{ productId: olives.id, quantity: "500" }],
  });
  const out = (e: { lines?: { role: string; lot: { id: string } }[] }) =>
    e.lines?.find((l) => l.role === "output")?.lot.id ?? "";
  await post("/events", {
    type: "TRANSFORM",
    process: "other",
    occurredAt: ago(30),
    kdes: { description: "Milled and bottled" },
    inputs: [{ lotId: out(harvest), quantity: "500" }],
    outputs: [{ productId: bottle.id, lotCode: "B500-OPEN-1", quantity: "150" }],
  });

  // Create and publish the lot's public page from the lot page.
  await page.goto(`/orgs/${orgId}/lots`);
  await page.getByRole("link", { name: "B500-OPEN-1" }).click();
  await page.getByRole("button", { name: "Create public page" }).click();
  await expect(page.getByText("What the public page may show")).toBeVisible();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByTestId("passport-status")).toHaveText("published");
  const qrPayload = (await page.getByTestId("qr-payload").textContent()) ?? "";
  expect(qrPayload).toBe("http://localhost:5173/01/08001234560034/10/B500-OPEN-1");
  await expect(page.getByRole("img", { name: /QR code linking to/ })).toBeVisible();

  // A consumer's phone: no session, mobile viewport, throttled to 4G, no JavaScript.
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    javaScriptEnabled: false,
  });
  const p = await phone.newPage();
  const cdp = await phone.newCDPSession(p);
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 70,
    downloadThroughput: (9 * 1024 * 1024) / 8,
    uploadThroughput: (4 * 1024 * 1024) / 8,
  });
  const started = Date.now();
  await p.goto(qrPayload, { waitUntil: "load" });
  const elapsed = Date.now() - started;
  // The resolver tags the visit as a QR scan for the view counts.
  expect(p.url()).toMatch(/\/p\/[a-z0-9]+\?src=qr$/);
  await expect(p.getByRole("heading", { name: "Olio extravergine 500 ml" })).toBeVisible();
  await expect(p.getByText("B500-OPEN-1")).toBeVisible();
  await expect(p.getByText(/Signature valid/)).toBeVisible();
  console.log(`QR → public page over emulated 4G: ${elapsed} ms`);
  expect(elapsed).toBeLessThan(2000);

  // Italian, then an accessibility scan (axe needs script injection: use a JS-enabled context).
  await p.getByRole("link", { name: "IT" }).click();
  await expect(p.getByText("Lotto")).toBeVisible();
  const a11y = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const ap = await a11y.newPage();
  await ap.goto(p.url());
  const results = await new AxeBuilder({ page: ap })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);

  // The directory finds the opted-in producer.
  await ap.goto(`/directory?q=${encodeURIComponent(orgName)}`);
  await expect(ap.getByRole("link", { name: orgName })).toBeVisible();
  const dir = await new AxeBuilder({ page: ap }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(dir.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
});
