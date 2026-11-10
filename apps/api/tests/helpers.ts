import { createDb, type Db } from "@casitrace/db";
import pino from "pino";
import { createApp } from "../src/app";
import { loadEnv } from "../src/config/env";
import type { Deps } from "../src/context";
import { createS3Storage, type ObjectStorage } from "../src/infrastructure/storage";
import { createAuth } from "../src/modules/identity/auth";

if (process.env.NODE_ENV !== "test" || !process.env.DATABASE_URL?.includes("_test")) {
  throw new Error("Integration tests must run via `bun run test` against the test database.");
}

export const env = loadEnv();
export const db: Db = createDb({ url: env.DATABASE_URL, max: 6 });
export const storage: ObjectStorage = createS3Storage({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  bucket: env.S3_BUCKET,
  accessKeyId: env.S3_ACCESS_KEY_ID,
  secretAccessKey: env.S3_SECRET_ACCESS_KEY,
});
export const logger = pino({ level: "silent" });

export const buildAuth = (rateLimit = true) =>
  createAuth({ db, logger, secret: env.AUTH_SECRET, webOrigin: env.WEB_ORIGIN, rateLimit });
export const auth = buildAuth();

export const buildApp = (overrides: Partial<Deps> = {}) =>
  createApp({ db, storage, logger, auth, version: "test", webOrigin: env.WEB_ORIGIN, ...overrides });
