import { ErrorEnvelope, HealthResponse, ReadinessResponse } from "@casitrace/contracts";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv, Deps } from "../../context";

const health = createRoute({
  method: "get",
  path: "/health",
  tags: ["System"],
  summary: "Liveness: the process is up",
  responses: { 200: { description: "Alive", content: { "application/json": { schema: HealthResponse } } } },
});

const ready = createRoute({
  method: "get",
  path: "/ready",
  tags: ["System"],
  summary: "Readiness: database and object storage are reachable",
  responses: {
    200: { description: "Ready", content: { "application/json": { schema: ReadinessResponse } } },
    503: { description: "Not ready", content: { "application/json": { schema: ReadinessResponse } } },
    500: { description: "Error", content: { "application/json": { schema: ErrorEnvelope } } },
  },
});

const timed = async (fn: () => Promise<unknown>) => {
  const start = performance.now();
  try {
    await fn();
    return { status: "ok" as const, latencyMs: Math.round(performance.now() - start) };
  } catch (e) {
    return {
      status: "fail" as const,
      latencyMs: Math.round(performance.now() - start),
      error: e instanceof Error ? e.message : String(e),
    };
  }
};

export const systemRoutes = (deps: Deps) =>
  new OpenAPIHono<AppEnv>()
    .openapi(health, (c) =>
      c.json({ status: "ok" as const, service: "casitrace-api", version: deps.version }, 200),
    )
    .openapi(ready, async (c) => {
      const [database, storage] = await Promise.all([
        timed(() => deps.db.$queryRaw`SELECT 1`),
        timed(() => deps.storage.check()),
      ]);
      const ok = database.status === "ok" && storage.status === "ok";
      if (!ok) c.get("logger").warn({ database, storage }, "readiness check failed");
      // Don't leak internal error text publicly; details go to the log.
      const scrub = (d: typeof database) => ({ status: d.status, latencyMs: d.latencyMs });
      const body = {
        status: ok ? ("ok" as const) : ("fail" as const),
        checks: { database: scrub(database), storage: scrub(storage) },
      };
      return ok ? c.json(body, 200) : c.json(body, 503);
    });
