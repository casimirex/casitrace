import {
  context,
  propagation,
  type Registry,
  recordError,
  SpanStatusCode,
  trace,
  tracer,
} from "@casitrace/observability";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../context";

export const httpMetrics = (registry: Registry) => ({
  requests: registry.counter(
    "casitrace_http_requests_total",
    "HTTP requests by route pattern and status class",
  ),
  duration: registry.histogram(
    "casitrace_http_request_duration_seconds",
    "HTTP request duration by route pattern",
  ),
  errors: registry.counter(
    "casitrace_unhandled_errors_total",
    "Unhandled server errors (bugs; see traces and logs)",
  ),
});
export type HttpMetrics = ReturnType<typeof httpMetrics>;

/**
 * One server span per request (continuing an incoming W3C traceparent) and RED metrics labelled by
 * the matched route pattern, never the raw path (IDs would explode cardinality and leak data).
 */
export const telemetry =
  (m: HttpMetrics): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    // Scrapes every 15 s would drown real traffic in traces and skew request metrics.
    if (c.req.path === "/api/metrics") return next();
    const parent = propagation.extract(context.active(), Object.fromEntries(c.req.raw.headers));
    const start = performance.now();
    await tracer().startActiveSpan(
      `${c.req.method}`,
      { kind: 1 /* SERVER */, attributes: { "http.request.method": c.req.method, "url.path": c.req.path } },
      parent,
      async (span) => {
        try {
          await next();
        } finally {
          const route = c.req.routePath && c.req.routePath !== "/*" ? c.req.routePath : "unmatched";
          const status = c.res.status;
          span.updateName(`${c.req.method} ${route}`);
          span.setAttribute("http.route", route);
          span.setAttribute("http.response.status_code", status);
          const requestId = c.get("requestId");
          if (requestId) span.setAttribute("casitrace.request_id", requestId);
          if (status >= 500) {
            if (c.error) recordError(span, c.error);
            else span.setStatus({ code: SpanStatusCode.ERROR });
          }
          span.end();
          const labels = { method: c.req.method, route, status: `${Math.floor(status / 100)}xx` };
          m.requests.inc(labels);
          m.duration.observe({ method: c.req.method, route }, (performance.now() - start) / 1000);
        }
      },
    );
  };

export const activeTraceId = () => trace.getActiveSpan()?.spanContext().traceId;
