import { describe, expect, test } from "bun:test";
import { DEV_SIGNING_KEY, loadEnv } from "../src/config/env";

describe("configuration", () => {
  test("rejects invalid configuration with a readable message", () => {
    expect(() => loadEnv({ DATABASE_URL: "not-a-url" })).toThrow(/DATABASE_URL/);
  });
});

describe("rate limiting cannot be disabled in production", () => {
  const base = {
    DATABASE_URL: "postgresql://a:b@localhost/x",
    WEB_ORIGIN: "https://app.example",
    AUTH_SECRET: "x".repeat(32),
    S3_ENDPOINT: "http://localhost:9000",
    S3_REGION: "eu",
    S3_BUCKET: "bucket",
    S3_ACCESS_KEY_ID: "a",
    S3_SECRET_ACCESS_KEY: "b",
    PASSPORT_SIGNING_KEY: "MC4CAQAwBQYDK2VwBCIEIPRODUCTIONKEYNOTTHEDEVKEY0000000000000000",
  };
  test("AUTH_RATE_LIMIT=off is refused when NODE_ENV=production", () => {
    expect(() => loadEnv({ ...base, NODE_ENV: "production", AUTH_RATE_LIMIT: "off" })).toThrow(
      /AUTH_RATE_LIMIT/,
    );
    expect(loadEnv({ ...base, NODE_ENV: "development", AUTH_RATE_LIMIT: "off" }).AUTH_RATE_LIMIT).toBe("off");
  });

  test("the development passport signing key is refused in production", () => {
    expect(() => loadEnv({ ...base, NODE_ENV: "production", PASSPORT_SIGNING_KEY: DEV_SIGNING_KEY })).toThrow(
      /development signing key/,
    );
  });
});

describe("production configuration (P9)", () => {
  const prod = {
    DATABASE_URL: "postgresql://a:b@localhost/x",
    WEB_ORIGIN: "https://app.example",
    AUTH_SECRET: "x".repeat(32),
    S3_ENDPOINT: "http://localhost:9000",
    S3_REGION: "eu",
    S3_BUCKET: "bucket",
    S3_ACCESS_KEY_ID: "a",
    S3_SECRET_ACCESS_KEY: "b",
    NODE_ENV: "production",
    PASSPORT_SIGNER: "kms",
    KMS_ADDR: "https://kms.internal:8200",
    KMS_ROLE_ID: "role",
    KMS_SECRET_ID: "secret",
    METRICS_TOKEN: "m".repeat(32),
  };
  test("a complete production configuration loads", () => {
    expect(loadEnv(prod).PASSPORT_SIGNER).toBe("kms");
  });
  test("production signs with the KMS, never a local key", () => {
    expect(() =>
      loadEnv({ ...prod, PASSPORT_SIGNER: "local", PASSPORT_SIGNING_KEY: "k".repeat(64) }),
    ).toThrow(/PASSPORT_SIGNER/);
  });
  test("production authenticates to the KMS with AppRole, not a static token", () => {
    expect(() => loadEnv({ ...prod, KMS_TOKEN: "root" })).toThrow(/KMS_TOKEN/);
    expect(() => loadEnv({ ...prod, KMS_ROLE_ID: undefined })).toThrow(/KMS_ROLE_ID/);
  });
  test("production needs a metrics token", () => {
    expect(() => loadEnv({ ...prod, METRICS_TOKEN: undefined })).toThrow(/METRICS_TOKEN/);
  });
  test("development: local signer needs its key", () => {
    const { NODE_ENV: _n, PASSPORT_SIGNER: _s, METRICS_TOKEN: _m, ...dev } = prod;
    expect(() => loadEnv({ ...dev, PASSPORT_SIGNER: "local" })).toThrow(/PASSPORT_SIGNING_KEY/);
  });
});
