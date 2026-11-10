import { afterAll, describe, expect, test } from "bun:test";
import { InMemorySpanExporter, startTracing } from "@casitrace/observability";
import { withTenant } from "../src/platform/tenant";
import { createOrg, verifiedUser } from "./auth-helpers";
import { buildApp, db } from "./helpers";

/** P9 hardening: shared rate limits across API instances, spoofed client IPs, security headers. */
afterAll(() => db.$disconnect());

const randomIp = () =>
  `10.${(Math.random() * 255) | 0}.${(Math.random() * 255) | 0}.${(Math.random() * 255) | 0}`;
const search = (app: ReturnType<typeof buildApp>, xff: string) =>
  app.request("/api/v1/public/directory?q=olio", { headers: { "x-forwarded-for": xff } });

describe("public rate limits (shared store)", () => {
  test("two API instances share one limit per client", async () => {
    const a = buildApp();
    const b = buildApp();
    const ip = randomIp();
    const statuses: number[] = [];
    for (let i = 0; i < 30; i++) statuses.push((await search(i % 2 ? a : b, ip)).status);
    expect(statuses.every((s) => s === 200)).toBe(true);
    const limited = await search(a, ip);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await search(b, ip)).status).toBe(429);
    // Another client is unaffected.
    expect((await search(b, randomIp())).status).toBe(200);
  });

  test("a client cannot escape its limit by sending its own X-Forwarded-For list", async () => {
    const app = buildApp();
    // Behind Caddy, a client-supplied header arrives as a list or is replaced. Lists are not trusted:
    // all such requests share one "untrusted" bucket, so rotating fake addresses gains nothing.
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) statuses.push((await search(app, `${randomIp()}, ${randomIp()}`)).status);
    expect(statuses.at(-1)).toBe(429);
    expect((await search(app, "not-an-ip")).status).toBe(429);
  });

  test("the store holds no IP addresses", async () => {
    const ip = randomIp();
    await search(buildApp(), ip);
    const rows = await db.$queryRaw<
      { n: bigint }[]
    >`SELECT count(*) AS n FROM rate_limit_bucket WHERE key LIKE ${`%${ip}%`}`;
    expect(Number(rows[0]?.n)).toBe(0);
  });
});

describe("security headers", () => {
  test("public HTML pages: strict CSP without scripts, no framing, nosniff, HSTS", async () => {
    const res = await buildApp().request("/api/v1/public/directory-page?q=ab", {
      headers: { "x-forwarded-for": randomIp() },
    });
    expect(res.status).toBe(200);
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("script-src");
    expect(csp).not.toContain("unsafe-inline");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("vary")).toContain("Accept-Language");
    expect(res.headers.get("strict-transport-security")).toContain("max-age=");
    const html = await res.text();
    expect(html).not.toContain("<script");
    expect(html).not.toMatch(/ style="/);
    // The CSP hash matches the one inline stylesheet, so the page is styled.
    const css = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? "";
    const hash = new Bun.CryptoHasher("sha256").update(css).digest("base64");
    expect(csp).toContain(`'sha256-${hash}'`);
  });
});

describe("observability", () => {
  test("/api/metrics: hidden without the token; route patterns as labels, never raw IDs", async () => {
    const token = "m".repeat(32);
    const app = buildApp({ metricsToken: token });
    const id = "0198a0a0-0000-7000-8000-000000000001";
    await app.request(`/api/v1/public/passports/${id}`, { headers: { "x-forwarded-for": randomIp() } });
    expect((await app.request("/api/metrics")).status).toBe(404);
    expect(
      (await buildApp().request("/api/metrics", { headers: { authorization: `Bearer ${token}` } })).status,
    ).toBe(404);
    const res = await app.request("/api/metrics", { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain(
      'casitrace_http_requests_total{method="GET",route="/api/v1/public/passports/:publicId",status="4xx"} 1',
    );
    expect(text).toContain("casitrace_http_request_duration_seconds_bucket");
    expect(text).not.toContain(id);
  });

  test("traces: one server span per request, continuing the caller's trace; 5xx marked as errors", async () => {
    const exporter = new InMemorySpanExporter();
    const tracing = startTracing({ serviceName: "test", version: "0", environment: "test", exporter });
    try {
      const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
      const app = buildApp();
      await app.request("/api/health", { headers: { traceparent: `00-${traceId}-00f067aa0ba902b7-01` } });
      await app.request("/api/v1/public/keys", { headers: { "x-forwarded-for": randomIp() } });
      await tracing.flush();
      const spans = exporter.getFinishedSpans();
      const health = spans.find((s) => s.name === "GET /api/health");
      expect(health?.spanContext().traceId).toBe(traceId);
      expect(health?.attributes["http.response.status_code"]).toBe(200);
      expect(spans.some((s) => s.name === "GET /api/v1/public/keys")).toBe(true);

      const failing = buildApp({
        db: new Proxy(db, {
          get: (t, p) => (p === "$queryRaw" ? () => Promise.reject(new Error("db down")) : Reflect.get(t, p)),
        }),
      });
      const res = await failing.request("/api/v1/public/directory?q=olio", {
        headers: { "x-forwarded-for": randomIp() },
      });
      expect(res.status).toBe(500);
      expect(await res.text()).not.toContain("db down");
      await tracing.flush();
      const err = exporter.getFinishedSpans().find((s) => s.name === "GET /api/v1/public/directory");
      expect(err?.status.code).toBe(2); // ERROR
      expect(err?.events.some((e) => e.name === "exception")).toBe(true);
    } finally {
      await tracing.shutdown();
    }
  });
});

describe("pilot KPI: capture timing", () => {
  test("the form's capture time is kept in the event's audit entry; malformed headers are ignored", async () => {
    const app = buildApp();
    const owner = await verifiedUser(app, "kpi");
    const orgId = await createOrg(owner.client, "KPI Grove");
    const base = `/api/v1/orgs/${orgId}`;
    const post = async (p: string, body: unknown, headers: Record<string, string> = {}) => {
      const r = await owner.client.call("POST", `${base}${p}`, body, headers);
      if (r.status >= 300) throw new Error(`${p}: ${r.status} ${await r.text()}`);
      return (await r.json()) as { id: string };
    };
    const product = await post("/products", {
      sku: "OLV",
      name: "Olives",
      category: "olives",
      uomCode: "kg",
    });
    const plot = await post("/locations", { code: "P1", name: "Grove", type: "plot" });
    const harvest = (code: string) => ({
      type: "ORIGINATE",
      process: "harvest",
      occurredAt: new Date(Date.now() - 3_600_000).toISOString(),
      locationId: plot.id,
      kdes: { cultivars: ["Coratina"] },
      outputs: [{ productId: product.id, lotCode: code, quantity: "100" }],
    });
    const timed = await post("/events", harvest("K-1"), {
      "x-capture-ms": "73500",
      "x-capture-device": "touch",
    });
    const bad = await post("/events", harvest("K-2"), { "x-capture-ms": "-5", "x-capture-device": "fridge" });
    const audit = await withTenant(db, orgId, (tx) =>
      tx.auditLog.findMany({ where: { resourceId: { in: [timed.id, bad.id] } } }),
    );
    const data = (id: string) => audit.find((a) => a.resourceId === id)?.data as { capture?: unknown };
    expect(data(timed.id).capture).toEqual({ ms: 73500, device: "touch" });
    expect(data(bad.id).capture).toBeUndefined();
  });
});
