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
  PASSPORT_SIGNING_KEY: z.string().min(40),
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
    .safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  return parsed.data;
};
