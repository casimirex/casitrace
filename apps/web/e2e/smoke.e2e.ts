import { expect, test } from "@playwright/test";

test("API health endpoints are reachable through the web origin", async ({ request }) => {
  expect((await request.get("/api/health")).status()).toBe(200);
  const ready = await request.get("/api/ready");
  expect(ready.status()).toBe(200);
  expect(await ready.json()).toMatchObject({
    checks: { database: { status: "ok" }, storage: { status: "ok" } },
  });
});
