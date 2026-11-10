import { afterAll, describe, expect, test } from "bun:test";
import { createDb } from "@casitrace/db";
import { Registry } from "@casitrace/observability";
import { newId } from "@casitrace/shared";
import { instrument, serveWorkerHttp, workerMetrics } from "../src/observability";
import { runRetention } from "../src/retention";

const url = process.env.DATABASE_URL ?? "";
if (process.env.NODE_ENV !== "test" || !url.includes("_test")) throw new Error("run via `bun run test`");
const db = createDb({ url, max: 4 });
afterAll(() => db.$disconnect());
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

describe("data retention job", () => {
  test("deletes only what has passed its retention period", async () => {
    const userId = newId();
    await db.user.create({ data: { id: userId, name: "Retention", email: `ret-${userId}@example.test` } });
    const note = (readAt: Date | null, createdAt: Date) => ({
      id: newId(),
      userId,
      kind: "test",
      title: "t",
      body: "b",
      readAt,
      createdAt,
    });
    const oldRead = note(daysAgo(200), daysAgo(210));
    const recentRead = note(daysAgo(10), daysAgo(20));
    const oldUnread = note(null, daysAgo(400));
    const recentUnread = note(null, daysAgo(100));
    await db.notification.createMany({ data: [oldRead, recentRead, oldUnread, recentUnread] });
    const session = (expiresAt: Date) => ({
      id: newId(),
      userId,
      token: newId(),
      expiresAt,
      createdAt: daysAgo(60),
      updatedAt: daysAgo(60),
    });
    const oldSession = session(daysAgo(31));
    const recentSession = session(daysAgo(5));
    await db.session.createMany({ data: [oldSession, recentSession] });
    await db.rateLimitBucket.createMany({
      data: [
        { key: `old-${userId}`, count: 3, resetAt: daysAgo(1) },
        { key: `live-${userId}`, count: 3, resetAt: new Date(Date.now() + 60_000) },
      ],
    });

    const r = await runRetention(db);
    expect(r.notifications).toBeGreaterThanOrEqual(2);
    const left = await db.notification.findMany({ where: { userId } });
    expect(left.map((n) => n.id).sort()).toEqual([recentRead.id, recentUnread.id].sort());
    const sessions = await db.session.findMany({ where: { userId } });
    expect(sessions.map((s) => s.id)).toEqual([recentSession.id]);
    const buckets = await db.rateLimitBucket.findMany({ where: { key: { contains: userId } } });
    expect(buckets.map((b) => b.key)).toEqual([`live-${userId}`]);
  });
});

describe("worker metrics and health", () => {
  test("job metrics count outcomes and expose a valid Prometheus histogram", async () => {
    const m = workerMetrics();
    const ok = instrument(m, "sample.ok", async () => undefined);
    const bad = instrument(m, "sample.bad", async () => {
      throw new Error("boom");
    });
    const event = {
      eventId: newId(),
      type: "x",
      orgId: null,
      aggregateType: "a",
      aggregateId: newId(),
      payload: {},
      occurredAt: "",
    };
    await ok(event);
    await ok(event);
    await expect(bad(event)).rejects.toThrow("boom");
    const text = await m.registry.render();
    expect(text).toContain('casitrace_worker_jobs_total{outcome="ok",type="sample.ok"} 2');
    expect(text).toContain('casitrace_worker_jobs_total{outcome="error",type="sample.bad"} 1');
    expect(text).toContain('casitrace_worker_job_duration_seconds_bucket{type="sample.ok",le="+Inf"} 2');
    expect(text).toContain('casitrace_worker_job_duration_seconds_count{type="sample.ok"} 2');
  });

  test("/metrics needs the token; /health reflects the relay", async () => {
    const m = workerMetrics();
    let healthy = true;
    const token = "t".repeat(32);
    const server = serveWorkerHttp(m, 0, token, () => healthy);
    const base = `http://localhost:${server.port}`;
    try {
      expect((await fetch(`${base}/metrics`)).status).toBe(404);
      expect((await fetch(`${base}/metrics`, { headers: { authorization: "Bearer wrong" } })).status).toBe(
        404,
      );
      const res = await fetch(`${base}/metrics`, { headers: { authorization: `Bearer ${token}` } });
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("# TYPE casitrace_worker_jobs_total counter");
      expect((await fetch(`${base}/health`)).status).toBe(200);
      healthy = false;
      expect((await fetch(`${base}/health`)).status).toBe(503);
    } finally {
      await server.stop();
    }
  });

  test("label values are escaped", async () => {
    const r = new Registry();
    r.counter("x_total", "x").inc({ a: 'q"u\\o\nte' });
    expect(await r.render()).toContain('x_total{a="q\\"u\\\\o\\nte"} 1');
  });
});
