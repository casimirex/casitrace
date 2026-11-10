import type { Db } from "@casitrace/db";
import { inSpan, metricsAuthorized, Registry } from "@casitrace/observability";
import type { PgBoss } from "pg-boss";
import type { EventHandler } from "./events";

export const workerMetrics = () => {
  const registry = new Registry();
  const m = {
    registry,
    jobs: registry.counter("casitrace_worker_jobs_total", "Domain-event jobs by event type and outcome"),
    jobDuration: registry.histogram(
      "casitrace_worker_job_duration_seconds",
      "Domain-event job duration by type",
    ),
    relayLastSuccess: registry.gauge(
      "casitrace_outbox_relay_last_success_timestamp_seconds",
      "Last time the outbox relay completed a pass",
    ),
    outboxPending: registry.gauge("casitrace_outbox_pending_events", "Outbox events not yet relayed"),
    outboxOldest: registry.gauge(
      "casitrace_outbox_oldest_pending_age_seconds",
      "Age of the oldest unrelayed event",
    ),
    outboxFailing: registry.gauge(
      "casitrace_outbox_failing_events",
      "Unrelayed events that failed at least once",
    ),
    queue: registry.gauge("casitrace_queue_jobs", "pg-boss jobs by queue and state"),
    build: registry.gauge("casitrace_build_info", "Build version"),
    backupLast: registry.gauge(
      "casitrace_backup_last_success_timestamp_seconds",
      "Last successful base backup (0 = none recorded)",
    ),
    walArchived: registry.gauge("casitrace_wal_archived_total", "WAL segments archived since stats reset"),
    walFailed: registry.gauge(
      "casitrace_wal_archive_failed_total",
      "Failed WAL archive attempts since stats reset",
    ),
    walFailingNow: registry.gauge(
      "casitrace_wal_archive_failing",
      "1 when the most recent WAL archive attempt failed (point-in-time recovery at risk)",
    ),
  };
  return m;
};
export type WorkerMetrics = ReturnType<typeof workerMetrics>;

/** Reads queue depths at scrape time (aggregate counts only; no tenant data). */
export const collectQueues = (m: WorkerMetrics, db: Db, boss: PgBoss) =>
  m.registry.onCollect(async () => {
    const rows = await db.$queryRaw<{ pending: bigint; oldest: number | null; failing: bigint }[]>`
      SELECT count(*) AS pending,
             EXTRACT(EPOCH FROM now() - min(occurred_at))::float8 AS oldest,
             count(*) FILTER (WHERE attempts > 0) AS failing
      FROM outbox_event WHERE published_at IS NULL`;
    const r = rows[0];
    m.outboxPending.set({}, Number(r?.pending ?? 0));
    m.outboxOldest.set({}, r?.oldest ?? 0);
    m.outboxFailing.set({}, Number(r?.failing ?? 0));
    const [backup] = await db.$queryRaw<{ last: number | null }[]>`
      SELECT EXTRACT(EPOCH FROM max(finished_at))::float8 AS last FROM ops_backup_run`;
    m.backupLast.set({}, backup?.last ?? 0);
    const [wal] = await db.$queryRaw<{ archived: bigint; failed: bigint; failing: boolean }[]>`
      SELECT archived_count AS archived, failed_count AS failed,
             COALESCE(last_failed_time > COALESCE(last_archived_time, 'epoch'), false) AS failing
      FROM pg_stat_archiver`;
    m.walArchived.set({}, Number(wal?.archived ?? 0));
    m.walFailed.set({}, Number(wal?.failed ?? 0));
    m.walFailingNow.set({}, wal?.failing ? 1 : 0);
    for (const q of await boss.getQueues()) {
      m.queue.set({ queue: q.name, state: "ready" }, q.readyCount);
      m.queue.set({ queue: q.name, state: "active" }, q.activeCount);
      m.queue.set({ queue: q.name, state: "deferred" }, q.deferredCount);
      m.queue.set({ queue: q.name, state: "failed" }, q.failedCount);
    }
  });

/** Wraps an event handler with a span and job metrics. */
export const instrument =
  (m: WorkerMetrics, type: string, handler: EventHandler): EventHandler =>
  async (event) => {
    const start = performance.now();
    try {
      await inSpan(`job ${type}`, { "casitrace.event_id": event.eventId, "casitrace.event_type": type }, () =>
        handler(event),
      );
      m.jobs.inc({ type, outcome: "ok" });
    } catch (e) {
      m.jobs.inc({ type, outcome: "error" });
      throw e;
    } finally {
      m.jobDuration.observe({ type }, (performance.now() - start) / 1000);
    }
  };

/** /health (liveness for the container and uptime checks) and /metrics (token-protected). */
export const serveWorkerHttp = (
  m: WorkerMetrics,
  port: number,
  token: string | undefined,
  healthy: () => boolean,
) =>
  Bun.serve({
    port,
    fetch: async (req) => {
      const path = new URL(req.url).pathname;
      if (path === "/health")
        return healthy()
          ? Response.json({ status: "ok", service: "casitrace-worker" })
          : Response.json({ status: "fail", service: "casitrace-worker" }, { status: 503 });
      if (path === "/metrics" && metricsAuthorized(req.headers.get("authorization"), token))
        return new Response(await m.registry.render(), {
          headers: { "content-type": "text/plain; version=0.0.4" },
        });
      return new Response("Not found", { status: 404 });
    },
  });
