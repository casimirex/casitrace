import { z } from "zod";

/** Configuration is validated once at boot; the process exits on invalid config. */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  API_PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.url(),
  /** Connections per API process (Postgres max_connections must cover all processes). */
  DB_POOL_MAX: z.coerce.number().int().min(2).max(200).default(20),
  WEB_ORIGIN: z.url(),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  /** "off" only for local browser tests that create many accounts from one IP. Never off in production. */
  AUTH_RATE_LIMIT: z.enum(["on", "off"]).default("on"),
  /** "local": key in PASSPORT_SIGNING_KEY (development, tests). "kms": OpenBao/Vault Transit (required in production, ADR 0015). */
  PASSPORT_SIGNER: z.enum(["local", "kms"]).default("local"),
  PASSPORT_SIGNING_KEY: z.string().min(40).optional(),
  KMS_ADDR: z.url().optional(),
  KMS_TRANSIT_MOUNT: z.string().min(1).default("transit"),
  KMS_KEY_NAME: z.string().min(1).default("passport-signing"),
  /** Development only; production uses AppRole (KMS_ROLE_ID + KMS_SECRET_ID). */
  KMS_TOKEN: z.string().min(1).optional(),
  KMS_ROLE_ID: z.string().min(1).optional(),
  KMS_SECRET_ID: z.string().min(1).optional(),
  PASSPORT_PREVIOUS_KEYS: z
    .string()
    .default("[]")
    .transform((s, ctx) => {
      try {
        return z.array(z.object({ kid: z.string(), x: z.string() })).parse(JSON.parse(s));
      } catch {
        ctx.addIssue({ code: "custom", message: 'Use JSON like [{"kid":"…","x":"…"}]' });
        return z.NEVER;
      }
    }),
  PUBLIC_ORIGIN: z.url().optional(),
  /** OTLP/HTTP traces endpoint (e.g. http://otel:4318/v1/traces). Unset = tracing off. */
  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: z.url().optional(),
  /** Bearer token for GET /api/metrics (Prometheus). Unset = endpoint disabled. */
  METRICS_TOKEN: z.string().min(24).optional(),
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(3),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
});

export type Env = z.infer<typeof EnvSchema>;

/** The development-only passport key committed in .env.example (refused in production). */
export const DEV_SIGNING_KEY = "MC4CAQAwBQYDK2VwBCIEICy8Z9DZD_nSYQ9ZcruriOZSy93aK_gUY-wvcb2jbxgU";

export const loadEnv = (source: Record<string, string | undefined> = process.env): Env => {
  const parsed = EnvSchema.refine((e) => !(e.NODE_ENV === "production" && e.AUTH_RATE_LIMIT === "off"), {
    message: "AUTH_RATE_LIMIT cannot be off in production",
    path: ["AUTH_RATE_LIMIT"],
  })
    .refine((e) => !(e.NODE_ENV === "production" && e.PASSPORT_SIGNING_KEY === DEV_SIGNING_KEY), {
      message: "The development signing key cannot be used in production",
      path: ["PASSPORT_SIGNING_KEY"],
    })
    .refine((e) => !(e.NODE_ENV === "production" && e.PASSPORT_SIGNER !== "kms"), {
      message: "Production signs passports with the KMS (PASSPORT_SIGNER=kms)",
      path: ["PASSPORT_SIGNER"],
    })
    .refine((e) => e.PASSPORT_SIGNER !== "local" || e.PASSPORT_SIGNING_KEY, {
      message: "Required when PASSPORT_SIGNER=local",
      path: ["PASSPORT_SIGNING_KEY"],
    })
    .refine((e) => e.PASSPORT_SIGNER !== "kms" || e.KMS_ADDR, {
      message: "Required when PASSPORT_SIGNER=kms",
      path: ["KMS_ADDR"],
    })
    .refine((e) => e.PASSPORT_SIGNER !== "kms" || e.KMS_TOKEN || (e.KMS_ROLE_ID && e.KMS_SECRET_ID), {
      message: "Set KMS_ROLE_ID and KMS_SECRET_ID (or KMS_TOKEN in development)",
      path: ["KMS_ROLE_ID"],
    })
    .refine((e) => !(e.NODE_ENV === "production" && !e.METRICS_TOKEN), {
      message: "Production needs METRICS_TOKEN (monitoring scrapes /api/metrics)",
      path: ["METRICS_TOKEN"],
    })
    .refine((e) => !(e.NODE_ENV === "production" && e.KMS_TOKEN), {
      message: "Production authenticates to the KMS with AppRole, not a static token",
      path: ["KMS_TOKEN"],
    })
    .safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  return parsed.data;
};
