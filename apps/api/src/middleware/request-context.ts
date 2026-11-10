import { currentTraceId } from "@casitrace/observability";
import { newId } from "@casitrace/shared";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../context";
import type { Logger } from "../infrastructure/logger";

const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;

/** Assigns a request ID (reusing a well-formed incoming one), a child logger, and logs one line per request. */
export const requestContext =
  (logger: Logger): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const incoming = c.req.header("x-request-id");
    const requestId = incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : newId();
    const traceId = currentTraceId();
    const log = logger.child(traceId ? { requestId, traceId } : { requestId });
    c.set("requestId", requestId);
    c.set("logger", log);
    c.header("x-request-id", requestId);

    const start = performance.now();
    await next();
    const ms = Math.round(performance.now() - start);
    const status = c.res.status;
    log[status >= 500 ? "error" : "info"]({ method: c.req.method, path: c.req.path, status, ms }, "request");
  };
