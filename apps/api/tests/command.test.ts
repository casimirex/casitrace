import { afterAll, describe, expect, test } from "bun:test";
import { newId } from "@casitrace/shared";
import type { CommandContext } from "../src/platform/audit";
import { runCommand } from "../src/platform/command";
import { withPlatformAccess, withTenant } from "../src/platform/tenant";
import { db } from "./helpers";

afterAll(() => db.$disconnect());

const ctx = (orgId: string = newId()): CommandContext => ({
  actor: { type: "system", id: null },
  orgId,
  requestId: newId(),
});
// Prisma returns lazy thenables; Promise.resolve turns them into real promises for expect().rejects.
const run = <T>(p: PromiseLike<T>) => Promise.resolve(p);

const touch = (c: CommandContext, action = "sample.touched") =>
  runCommand(db, c, async () => ({
    result: null,
    audit: [{ action, resourceType: "sample", resourceId: null }],
  }));

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
    const audit = await withTenant(db, c.orgId ?? "", (tx) =>
      tx.auditLog.findMany({ where: { requestId: c.requestId } }),
    );
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

    expect(
      await withPlatformAccess(db, (tx) => tx.auditLog.count({ where: { requestId: c.requestId } })),
    ).toBe(0);
    expect(await db.outboxEvent.count({ where: { aggregateId: resourceId } })).toBe(0);
  });
});

describe("audit log is append-only (ADR 0007)", () => {
  test("the runtime role cannot UPDATE, DELETE or TRUNCATE it", async () => {
    const c = ctx();
    await touch(c);
    const row = await withTenant(db, c.orgId ?? "", (tx) =>
      tx.auditLog.findFirstOrThrow({ where: { requestId: c.requestId } }),
    );

    const denied = /append-only|permission denied/;
    await expect(
      withTenant(db, c.orgId ?? "", (tx) =>
        tx.auditLog.update({ where: { id: row.id }, data: { action: "x" } }),
      ),
    ).rejects.toThrow(denied);
    await expect(
      withTenant(db, c.orgId ?? "", (tx) => tx.auditLog.delete({ where: { id: row.id } })),
    ).rejects.toThrow(denied);
    await expect(run(db.$executeRawUnsafe('TRUNCATE "audit_log"'))).rejects.toThrow(denied);
  });
});

describe("row-level security on the audit log (ADR 0008)", () => {
  test("each organisation sees only its own rows; no scope sees nothing", async () => {
    const a = ctx();
    const b = ctx();
    await touch(a, "sample.a");
    await touch(b, "sample.b");
    const both = { requestId: { in: [a.requestId ?? "", b.requestId ?? ""] } };

    const seenByA = await withTenant(db, a.orgId ?? "", (tx) => tx.auditLog.findMany({ where: both }));
    expect(seenByA.map((r) => r.action)).toEqual(["sample.a"]);
    const seenByB = await withTenant(db, b.orgId ?? "", (tx) => tx.auditLog.findMany({ where: both }));
    expect(seenByB.map((r) => r.action)).toEqual(["sample.b"]);
    expect(await db.auditLog.count({ where: both })).toBe(0);
    expect(await withPlatformAccess(db, (tx) => tx.auditLog.count({ where: both }))).toBe(2);
  });

  test("the runtime role is not the table owner and cannot bypass RLS", async () => {
    const [role] = await db.$queryRaw<{ current_user: string; bypass: boolean; owner: string }[]>`
      SELECT current_user, r.rolbypassrls AS bypass, pg_get_userbyid(c.relowner) AS owner
      FROM pg_roles r, pg_class c WHERE r.rolname = current_user AND c.relname = 'audit_log'`;
    expect(role).toMatchObject({ current_user: "casitrace_app", bypass: false });
    expect(role?.owner).not.toBe("casitrace_app");
    await expect(
      run(db.$executeRawUnsafe('DROP TRIGGER audit_log_append_only ON "audit_log"')),
    ).rejects.toThrow(/must be owner/);
  });
});
