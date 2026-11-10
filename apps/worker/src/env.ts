import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: z.url(),
  OUTBOX_POLL_MS: z.coerce.number().int().min(100).default(1000),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().min(3),
  WEB_ORIGIN: z.url(),
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(3),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  CLAMAV_HOST: z.string().min(1).default("localhost"),
  CLAMAV_PORT: z.coerce.number().int().positive().default(3310),
  /** Cron (UTC) for the certificate expiry check. */
  EXPIRY_CRON: z.string().default("0 5 * * *"),
  /** Domain-event jobs processed in parallel by this worker process. */
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(100),
  /** Port for /health and /metrics. */
  WORKER_METRICS_PORT: z.coerce.number().int().min(0).max(65535).default(9464),
  METRICS_TOKEN: z.string().min(24).optional(),
  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: z.url().optional(),
  /** Daily data-retention job (UTC cron), see docs/compliance/data-retention.md. */
  RETENTION_CRON: z.string().default("30 3 * * *"),
});
export type WorkerEnv = z.infer<typeof EnvSchema>;

export const loadWorkerEnv = (source: Record<string, string | undefined> = process.env): WorkerEnv => {
  const parsed = EnvSchema.refine((e) => !(e.NODE_ENV === "production" && !e.METRICS_TOKEN), {
    message: "Production needs METRICS_TOKEN",
    path: ["METRICS_TOKEN"],
  }).safeParse(source);
  if (!parsed.success) {
    throw new Error(
      `Invalid worker configuration:\n${parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")}`,
    );
  }
  return parsed.data;
};
