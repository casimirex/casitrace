import { afterAll, describe, expect, test } from "bun:test";
import { newId } from "@casitrace/shared";
import type { CommandContext } from "../src/platform/audit";
import { runCommand } from "../src/platform/command";
import { db } from "./helpers";

afterAll(() => db.$disconnect());

const ctx = (): CommandContext => ({
  actor: { type: "system", id: null },
  orgId: newId(),
  requestId: newId(),
});

describe("runCommand", () => {
  test("commits the audit record and outbox event together with the result", async () => {
    const c = ctx();
    const resourceId = newId();
    const result = await runCommand(db, c, async () => ({
      result: { ok: true },
      audit: [{ action: "sample.created", resourceType: "sample", resourceId, data: { name: "first" } }],
      events: [
        {
          type: "sample.created",
          aggregateType: "sample",
          aggregateId: resourceId,
          payload: { name: "first" },
        },
      ],
    }));

    expect(result).toEqual({ ok: true });
    const audit = await db.auditLog.findMany({ where: { requestId: c.requestId } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      orgId: c.orgId,
      action: "sample.created",
      resourceId,
      actorType: "system",
    });
    const events = await db.outboxEvent.findMany({ where: { aggregateId: resourceId } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ orgId: c.orgId, type: "sample.created", publishedAt: null });
  });

  test("rolls back everything when the handler fails", async () => {
    const c = ctx();
    const resourceId = newId();
    await expect(
      runCommand(db, c, async (tx) => {
        await tx.outboxEvent.create({
          data: {
            id: newId(),
            type: "sample.partial",
            aggregateType: "sample",
            aggregateId: resourceId,
            payload: {},
          },
        });
        throw new Error("business rule violated");
      }),
    ).rejects.toThrow("business rule violated");

    expect(await db.auditLog.count({ where: { requestId: c.requestId } })).toBe(0);
    expect(await db.outboxEvent.count({ where: { aggregateId: resourceId } })).toBe(0);
  });
});

describe("audit log is append-only (ADR 0007)", () => {
  test("UPDATE, DELETE and TRUNCATE are rejected by the database", async () => {
    const c = ctx();
    await runCommand(db, c, async () => ({
      result: null,
      audit: [{ action: "sample.touched", resourceType: "sample", resourceId: null }],
    }));
    const row = await db.auditLog.findFirstOrThrow({ where: { requestId: c.requestId } });

    // Prisma returns lazy thenables; Promise.resolve turns them into real promises for expect().rejects.
    const run = <T>(p: PromiseLike<T>) => Promise.resolve(p);
    await expect(
      run(db.auditLog.update({ where: { id: row.id }, data: { action: "tampered" } })),
    ).rejects.toThrow(/append-only/);
    await expect(run(db.auditLog.delete({ where: { id: row.id } }))).rejects.toThrow(/append-only/);
    await expect(run(db.$executeRawUnsafe('TRUNCATE "audit_log"'))).rejects.toThrow(/append-only/);
    expect((await db.auditLog.findUniqueOrThrow({ where: { id: row.id } })).action).toBe("sample.touched");
  });
});
