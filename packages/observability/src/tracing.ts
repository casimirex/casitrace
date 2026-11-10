import { context, propagation, type Span, SpanStatusCode, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor, type SpanExporter, TracerProvider } from "@opentelemetry/sdk-trace";

export interface TracingConfig {
  serviceName: string;
  version: string;
  environment: string;
  /** OTLP/HTTP traces endpoint, e.g. http://collector:4318/v1/traces. Unset = tracing off (no-op API). */
  endpoint?: string;
  /** For tests: export to this instead of OTLP. */
  exporter?: SpanExporter;
}

/**
 * Starts OpenTelemetry tracing (W3C trace context, async context propagation, batched OTLP export).
 * Code everywhere uses the @opentelemetry/api no-op tracer when tracing is off, so this is optional.
 */
export const startTracing = (
  cfg: TracingConfig,
): { shutdown(): Promise<void>; flush(): Promise<void>; enabled: boolean } => {
  const exporter = cfg.exporter ?? (cfg.endpoint ? new OTLPTraceExporter({ url: cfg.endpoint }) : undefined);
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  if (!exporter) return { enabled: false, shutdown: async () => undefined, flush: async () => undefined };
  const provider = new TracerProvider({
    resource: resourceFromAttributes({
      "service.name": cfg.serviceName,
      "service.version": cfg.version,
      "deployment.environment.name": cfg.environment,
    }),
    spanProcessors: [new BatchSpanProcessor({ exporter, scheduledDelayMillis: 1000 })],
  });
  trace.setGlobalTracerProvider(provider);
  return { enabled: true, shutdown: () => provider.shutdown(), flush: () => provider.forceFlush() };
};

export const tracer = () => trace.getTracer("casitrace");

/** Runs fn in a child span; records exceptions and marks the span as an error. */
export const inSpan = <T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: (span: Span) => Promise<T>,
) =>
  tracer().startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await fn(span);
    } catch (e) {
      recordError(span, e);
      throw e;
    } finally {
      span.end();
    }
  });

export const recordError = (span: Span, e: unknown) => {
  span.recordException(e instanceof Error ? e : new Error(String(e)));
  span.setStatus({ code: SpanStatusCode.ERROR, message: e instanceof Error ? e.name : "error" });
};

/** Trace ID of the active span (for log correlation), or undefined. */
export const currentTraceId = () => {
  const id = trace.getActiveSpan()?.spanContext().traceId;
  return id && id !== "00000000000000000000000000000000" ? id : undefined;
};

/** For tests. */
export { InMemorySpanExporter } from "@opentelemetry/sdk-trace";
export type { Span };
export { context, propagation, SpanStatusCode, trace };
