import type { Db } from "@casitrace/db";
import type { RelayedEvent } from "./events";

/** Anything that can accept a relayed event; pg-boss in production, a fake in unit tests. */
export interface EventSink {
  send(event: RelayedEvent): Promise<void>;
}

interface OutboxRow {
  id: string;
  org_id: string | null;
  type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: unknown;
  occurred_at: Date;
}

/**
 * Relays one batch of unpublished outbox rows to the sink (ADR 0010).
 * Rows are locked with SKIP LOCKED so several workers can run safely. Delivery is at-least-once:
 * if the commit fails after a send, the row is sent again, so consumers dedupe on eventId.
 * Returns the number of rows published.
 */
export const relayOutboxBatch = async (db: Db, sink: EventSink, batchSize: number): Promise<number> =>
  db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<OutboxRow[]>`
      SELECT id, org_id, type, aggregate_type, aggregate_id, payload, occurred_at
      FROM outbox_event
      WHERE published_at IS NULL
      ORDER BY occurred_at, id
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED`;

    let published = 0;
    for (const row of rows) {
      try {
        await sink.send({
          eventId: row.id,
          type: row.type,
          orgId: row.org_id,
          aggregateType: row.aggregate_type,
          aggregateId: row.aggregate_id,
          payload: row.payload,
          occurredAt: row.occurred_at.toISOString(),
        });
        await tx.outboxEvent.update({
          where: { id: row.id },
          data: { publishedAt: new Date(), attempts: { increment: 1 } },
        });
        published++;
      } catch (e) {
        await tx.outboxEvent.update({
          where: { id: row.id },
          data: {
            attempts: { increment: 1 },
            lastError: e instanceof Error ? e.message.slice(0, 2000) : String(e),
          },
        });
      }
    }
    return published;
  });
