import { describe, expect, test } from "bun:test";
import { newId } from "@casitrace/shared";
import { env, storage } from "./helpers";

describe("object storage (ADR 0011)", () => {
  test("objects are private, and presigned URLs grant time-limited access", async () => {
    const key = `tests/${newId()}.txt`;
    await storage.put(key, "evidence bytes", "text/plain");
    expect(await storage.exists(key)).toBe(true);

    const anonymous = await fetch(`${env.S3_ENDPOINT}/${env.S3_BUCKET}/${key}`);
    expect(anonymous.status).toBe(403);

    const signed = await fetch(storage.presign(key, { method: "GET", expiresInSeconds: 60 }));
    expect(signed.status).toBe(200);
    expect(await signed.text()).toBe("evidence bytes");

    await storage.delete(key);
    expect(await storage.exists(key)).toBe(false);
  });

  test("presigned uploads work", async () => {
    const key = `tests/${newId()}.bin`;
    const res = await fetch(storage.presign(key, { method: "PUT", expiresInSeconds: 60 }), {
      method: "PUT",
      body: "abc",
    });
    expect(res.status).toBe(200);
    expect(await storage.exists(key)).toBe(true);
    await storage.delete(key);
  });

  test("presign expiry is capped at 15 minutes", () => {
    expect(() => storage.presign("x", { method: "GET", expiresInSeconds: 3600 })).toThrow();
    expect(() => storage.presign("x", { method: "GET", expiresInSeconds: 0 })).toThrow();
  });
});
