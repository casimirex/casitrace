import { createDb } from "@casitrace/db";
import pino from "pino";
import { bossSink, createBoss, ensureQueues, startConsumers } from "./boss";
import { createEmailHandler } from "./email/sender";
import { loadWorkerEnv } from "./env";
import { EventRegistry } from "./events";
import { relayOutboxBatch } from "./outbox-relay";

const env = loadWorkerEnv();
const logger = pino({ level: env.LOG_LEVEL, base: { service: "casitrace-worker" } });
const db = createDb({ url: env.DATABASE_URL, max: 5 });
const boss = createBoss(env.DATABASE_URL);
boss.on("error", (err) => logger.error({ err }, "pg-boss error"));

const registry = new EventRegistry().on(
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
);

await boss.start();
await ensureQueues(boss);
await startConsumers(boss, registry);
logger.info("worker started");

let running = true;
const sink = bossSink(boss);
const loop = async () => {
  while (running) {
    try {
      const n = await relayOutboxBatch(db, sink, env.OUTBOX_BATCH_SIZE);
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
  await db.$disconnect();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
