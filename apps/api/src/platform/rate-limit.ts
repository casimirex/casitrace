import { AppError } from "@casitrace/shared";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../context";

/**
 * Per-IP fixed-window limiter for public, unauthenticated endpoints (scraping protection).
 * In-memory: correct for one API instance; use a shared store before running several (P9).
 */
export const rateLimit = (name: string, max: number, windowMs = 60_000): MiddlewareHandler<AppEnv> => {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return async (c, next) => {
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "local";
    const now = Date.now();
    const key = `${name}:${ip}`;
    const h = hits.get(key);
    if (!h || h.resetAt <= now) hits.set(key, { count: 1, resetAt: now + windowMs });
    else if (++h.count > max) {
      c.header("retry-after", String(Math.ceil((h.resetAt - now) / 1000)));
      throw new AppError("RATE_LIMITED", "Too many requests. Try again in a minute.");
    }
    if (hits.size > 50_000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    return next();
  };
};
