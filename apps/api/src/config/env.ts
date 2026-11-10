import { z } from "zod";

/** Configuration is validated once at boot; the process exits on invalid config. */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  API_PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.url(),
  WEB_ORIGIN: z.url(),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  /** "off" only for local browser tests that create many accounts from one IP. Never off in production. */
  AUTH_RATE_LIMIT: z.enum(["on", "off"]).default("on"),
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(3),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
});

export type Env = z.infer<typeof EnvSchema>;

export const loadEnv = (source: Record<string, string | undefined> = process.env): Env => {
  const parsed = EnvSchema.refine((e) => !(e.NODE_ENV === "production" && e.AUTH_RATE_LIMIT === "off"), {
    message: "AUTH_RATE_LIMIT cannot be off in production",
    path: ["AUTH_RATE_LIMIT"],
  }).safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  return parsed.data;
};
