import { afterAll, describe, expect, test } from "bun:test";
import type { ObjectStorage } from "@casitrace/shared";
import { buildApp, db, storage } from "./helpers";

afterAll(() => db.$disconnect());

describe("system routes", () => {
  const app = buildApp();

  test("GET /health returns ok and a request ID", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", service: "casitrace-api", version: "test" });
    expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("a well-formed incoming request ID is echoed; a malformed one is replaced", async () => {
    const good = await app.request("/api/health", { headers: { "x-request-id": "trace-abc-12345" } });
    expect(good.headers.get("x-request-id")).toBe("trace-abc-12345");
    const bad = await app.request("/api/health", { headers: { "x-request-id": "<script>" } });
    expect(bad.headers.get("x-request-id")).not.toBe("<script>");
  });

  test("GET /ready checks the real database and storage", async () => {
    const res = await app.request("/api/ready");
    const body = (await res.json()) as { status: string; checks: Record<string, { status: string }> };
    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.checks.database?.status).toBe("ok");
    expect(body.checks.storage?.status).toBe("ok");
  });

  test("GET /ready returns 503 without leaking internal error text when storage fails", async () => {
    const broken: ObjectStorage = {
      ...storage,
      check: async () => {
        throw new Error("secret-host:9000 refused");
      },
    };
    const res = await buildApp({ storage: broken }).request("/api/ready");
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(text).toContain('"storage":{"status":"fail"');
    expect(text).not.toContain("secret-host");
  });

  test("unknown routes return the standard error envelope", async () => {
    const res = await app.request("/api/v1/nope");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.requestId).toBe(res.headers.get("x-request-id") ?? "missing");
  });

  test("security headers are set", async () => {
    const res = await app.request("/api/health");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });

  test("the OpenAPI document lists the system routes", async () => {
    const res = await app.request("/api/openapi.json");
    const doc = (await res.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(["/health", "/ready"]));
  });
});
