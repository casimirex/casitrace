import { describe, expect, test } from "bun:test";
import { loadEnv } from "../src/config/env";

describe("configuration", () => {
  test("rejects invalid configuration with a readable message", () => {
    expect(() => loadEnv({ DATABASE_URL: "not-a-url" })).toThrow(/DATABASE_URL/);
  });
});

describe("rate limiting cannot be disabled in production", () => {
  test("AUTH_RATE_LIMIT=off is refused when NODE_ENV=production", () => {
    const base = {
      DATABASE_URL: "postgresql://a:b@localhost/x",
      WEB_ORIGIN: "https://app.example",
      AUTH_SECRET: "x".repeat(32),
      S3_ENDPOINT: "http://localhost:9000",
      S3_REGION: "eu",
      S3_BUCKET: "bucket",
      S3_ACCESS_KEY_ID: "a",
      S3_SECRET_ACCESS_KEY: "b",
    };
    expect(() => loadEnv({ ...base, NODE_ENV: "production", AUTH_RATE_LIMIT: "off" })).toThrow(
      /AUTH_RATE_LIMIT/,
    );
    expect(loadEnv({ ...base, NODE_ENV: "development", AUTH_RATE_LIMIT: "off" }).AUTH_RATE_LIMIT).toBe("off");
  });
});
