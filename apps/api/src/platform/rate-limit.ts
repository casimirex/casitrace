import type { Db } from "@casitrace/db";
import { AppError } from "@casitrace/shared";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../context";
import { clientIp } from "./client-ip";

/** A fixed-window counter shared by every API instance. */
export interface RateLimitStore {
  hit(key: string, windowMs: number): Promise<{ count: number; resetAt: Date }>;
}

/** Postgres store (UNLOGGED table `rate_limit_bucket`); one atomic upsert per request. */
export const postgresRateLimitStore = (db: Db): RateLimitStore => ({
  hit: async (key, windowMs) => {
    const rows = await db.$queryRaw<{ count: number; reset_at: Date }[]>`
      INSERT INTO rate_limit_bucket (key, count, reset_at)
      VALUES (${key}, 1, now() + make_interval(secs => ${windowMs / 1000}))
      ON CONFLICT (key) DO UPDATE SET
        count = CASE WHEN rate_limit_bucket.reset_at <= now() THEN 1 ELSE rate_limit_bucket.count + 1 END,
        reset_at = CASE WHEN rate_limit_bucket.reset_at <= now() THEN EXCLUDED.reset_at ELSE rate_limit_bucket.reset_at END
      RETURNING count, reset_at`;
    const r = rows[0];
    if (!r) throw new Error("rate limit upsert returned no row");
    return { count: r.count, resetAt: r.reset_at };
  },
});

/** Keys are hashed so the table holds no IP addresses (GDPR data minimisation). */
const bucketKey = (name: string, ip: string, salt: string) =>
  `${name}:${new Bun.CryptoHasher("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32)}`;

/**
 * Per-client fixed-window limiter for public, unauthenticated endpoints (scraping protection).
 * If the store is unavailable the request fails like any other database failure (no silent fail-open).
 */
export const rateLimit =
  (
    store: RateLimitStore,
    salt: string,
    name: string,
    max: number,
    windowMs = 60_000,
  ): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const { count, resetAt } = await store.hit(bucketKey(name, clientIp(c), salt), windowMs);
    if (count > max) {
      c.header("retry-after", String(Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000))));
      throw new AppError("RATE_LIMITED", "Too many requests. Try again in a minute.");
    }
    return next();
  };
