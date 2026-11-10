import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createDb } from "@casitrace/db";
import { newId } from "@casitrace/shared";
import { bossSink, createBoss, ensureQueues, startConsumers } from "../src/boss";
import { EventRegistry, type RelayedEvent } from "../src/events";
import { type EventSink, relayOutboxBatch } from "../src/outbox-relay";

const url = process.env.DATABASE_URL ?? "";
if (process.env.NODE_ENV !== "test" || !url.includes("_test")) throw new Error("run via `bun run test`");
const db = createDb({ url, max: 4 });
afterAll(() => db.$disconnect());

const insertEvent = async (type = "sample.created") => {
  const id = newId();
  await db.outboxEvent.create({
    data: { id, orgId: newId(), type, aggregateType: "sample", aggregateId: newId(), payload: { n: 1 } },
  });
  return id;
};

describe("outbox relay (ADR 0010)", () => {
  beforeEach(async () => {
    await db.outboxEvent.deleteMany({});
  });

  test("publishes pending rows in order and marks them published", async () => {
    const a = await insertEvent();
    const b = await insertEvent();
    const sent: RelayedEvent[] = [];
    const sink: EventSink = { send: async (e) => void sent.push(e) };

    expect(await relayOutboxBatch(db, sink, 10)).toBe(2);
    expect(sent.map((e) => e.eventId)).toEqual([a, b]);
    expect(await db.outboxEvent.count({ where: { publishedAt: null } })).toBe(0);
    expect(await relayOutboxBatch(db, sink, 10)).toBe(0);
  });

  test("a failed send keeps the row pending and records the error", async () => {
    const id = await insertEvent();
    const sink: EventSink = {
      send: async () => {
        throw new Error("queue down");
      },
    };

    expect(await relayOutboxBatch(db, sink, 10)).toBe(0);
    const row = await db.outboxEvent.findUniqueOrThrow({ where: { id } });
    expect(row.publishedAt).toBeNull();
    expect(row.attempts).toBe(1);
    expect(row.lastError).toBe("queue down");
  });

  test("concurrent relays never send the same row twice", async () => {
    const ids = await Promise.all(Array.from({ length: 20 }, () => insertEvent()));
    const sent: string[] = [];
    const sink: EventSink = {
      send: async (e) => {
        await Bun.sleep(5);
        sent.push(e.eventId);
      },
    };
    await Promise.all([
      relayOutboxBatch(db, sink, 20),
      relayOutboxBatch(db, sink, 20),
      relayOutboxBatch(db, sink, 20),
    ]);
    expect(new Set(sent).size).toBe(sent.length);
    expect(sent.sort()).toEqual([...ids].sort());
  });

  test("round trip: outbox row → pg-boss → registered handler", async () => {
    const boss = createBoss(url);
    await boss.start();
    await ensureQueues(boss);
    const received = Promise.withResolvers<RelayedEvent>();
    const registry = new EventRegistry().on("sample.roundtrip", async (e) => received.resolve(e));
    await startConsumers(boss, registry, 0.5);

    const id = await insertEvent("sample.roundtrip");
    expect(await relayOutboxBatch(db, bossSink(boss), 10)).toBe(1);

    const event = await Promise.race([
      received.promise,
      Bun.sleep(10_000).then(() => {
        throw new Error("handler not called within 10 s");
      }),
    ]);
    expect(event.eventId).toBe(id);
    expect(event.payload).toEqual({ n: 1 });
    await boss.stop({ graceful: false });
  });
});
