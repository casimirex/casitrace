import { createDb } from "@casitrace/db";
import { startTracing } from "@casitrace/observability";
import { createS3Storage } from "@casitrace/shared";
import pino from "pino";
import pkg from "../package.json" with { type: "json" };
import { bossSink, createBoss, ensureQueues, startConsumers } from "./boss";
import { createEmailHandler } from "./email/sender";
import { loadWorkerEnv } from "./env";
import { EventRegistry } from "./events";
import { createClamavScanner } from "./evidence/clamav";
import { runExpiryCheck } from "./evidence/expiry";
import { createScanHandler } from "./evidence/scan-handler";
import { collectQueues, instrument, serveWorkerHttp, workerMetrics } from "./observability";
import { relayOutboxBatch } from "./outbox-relay";
import { runRetention } from "./retention";

const env = loadWorkerEnv();
const logger = pino({ level: env.LOG_LEVEL, base: { service: "casitrace-worker" } });
const tracing = startTracing({
  serviceName: "casitrace-worker",
  version: pkg.version,
  environment: env.NODE_ENV,
  endpoint: env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
});
const metrics = workerMetrics();
metrics.build.set({ service: "worker", version: pkg.version }, 1);
// One connection per concurrent job, plus the outbox relay and scheduled jobs.
const db = createDb({ url: env.DATABASE_URL, max: env.WORKER_CONCURRENCY + 4 });
const boss = createBoss(env.DATABASE_URL);
boss.on("error", (err) => logger.error({ err }, "pg-boss error"));

const storage = createS3Storage({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  bucket: env.S3_BUCKET,
  accessKeyId: env.S3_ACCESS_KEY_ID,
  secretAccessKey: env.S3_SECRET_ACCESS_KEY,
});
const scanner = createClamavScanner(env.CLAMAV_HOST, env.CLAMAV_PORT);

const registry = new EventRegistry()
  .on(
    "evidence.file_uploaded",
    instrument(metrics, "evidence.file_uploaded", createScanHandler(db, storage, scanner)),
  )
  .on(
    "email.requested",
    instrument(
      metrics,
      "email.requested",
      createEmailHandler(
        {
          host: env.SMTP_HOST,
          port: env.SMTP_PORT,
          from: env.MAIL_FROM,
          ...(env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? "" } : {}),
        },
        db,
      ),
    ),
  );

await boss.start();
collectQueues(metrics, db, boss);
await ensureQueues(boss);
await startConsumers(boss, registry, 1, env.WORKER_CONCURRENCY);

// Daily certificate expiry check (warnings at 30/7/0 days; expire after the end date).
const EXPIRY_QUEUE = "evidence-expiry-check";
await boss.createQueue(EXPIRY_QUEUE);
await boss.schedule(EXPIRY_QUEUE, env.EXPIRY_CRON, null, { tz: "UTC" });
await boss.work(EXPIRY_QUEUE, async () => {
  const r = await runExpiryCheck(db, new Date(), env.WEB_ORIGIN);
  logger.info(r, "evidence expiry check");
});
// Daily data-retention clean-up (docs/compliance/data-retention.md).
const RETENTION_QUEUE = "data-retention";
await boss.createQueue(RETENTION_QUEUE);
await boss.schedule(RETENTION_QUEUE, env.RETENTION_CRON, null, { tz: "UTC" });
await boss.work(RETENTION_QUEUE, async () => {
  logger.info(await runRetention(db), "data retention");
});
logger.info("worker started");

let running = true;
let lastRelay = Date.now();
// Healthy while the outbox relay keeps completing passes.
const http = serveWorkerHttp(
  metrics,
  env.WORKER_METRICS_PORT,
  env.METRICS_TOKEN,
  () => Date.now() - lastRelay < 60_000,
);
logger.info({ port: http.port }, "worker health and metrics listening");
const sink = bossSink(boss);
const loop = async () => {
  while (running) {
    try {
      const n = await relayOutboxBatch(db, sink, env.OUTBOX_BATCH_SIZE);
      lastRelay = Date.now();
      metrics.relayLastSuccess.set({}, lastRelay / 1000);
      if (n > 0) logger.debug({ published: n }, "outbox relayed");
      if (n < env.OUTBOX_BATCH_SIZE) await Bun.sleep(env.OUTBOX_POLL_MS);
    } catch (err) {
      logger.error({ err }, "outbox relay failed");
      await Bun.sleep(env.OUTBOX_POLL_MS * 5);
    }
  }
};
const relay = loop();

const shutdown = async (signal: string) => {
  logger.info({ signal }, "shutting down");
  running = false;
  await relay;
  await boss.stop({ graceful: true });
  await http.stop();
  await tracing.shutdown();
  await db.$disconnect();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
