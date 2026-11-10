import { createDb } from "@casitrace/db";
import pkg from "../package.json" with { type: "json" };
import { createApp } from "./app";
import { loadEnv } from "./config/env";
import { createLogger } from "./infrastructure/logger";
import { createS3Storage } from "./infrastructure/storage";
import { createAuth } from "./modules/identity/auth";

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL);
const db = createDb({ url: env.DATABASE_URL });
const storage = createS3Storage({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  bucket: env.S3_BUCKET,
  accessKeyId: env.S3_ACCESS_KEY_ID,
  secretAccessKey: env.S3_SECRET_ACCESS_KEY,
});
const auth = createAuth({ db, logger, secret: env.AUTH_SECRET, webOrigin: env.WEB_ORIGIN });

const app = createApp({ db, storage, logger, auth, version: pkg.version, webOrigin: env.WEB_ORIGIN });
const server = Bun.serve({ port: env.API_PORT, fetch: app.fetch });
logger.info({ port: server.port }, "api listening");

const shutdown = async (signal: string) => {
  logger.info({ signal }, "shutting down");
  await server.stop();
  await db.$disconnect();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
