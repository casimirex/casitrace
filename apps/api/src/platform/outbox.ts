import type { Prisma, Tx } from "@casitrace/db";
import { newId } from "@casitrace/shared";

export interface DomainEvent {
  type: string; // "<aggregate>.<past-tense verb>", e.g. "lot.shipped"
  aggregateType: string;
  aggregateId: string;
  payload: Prisma.InputJsonValue;
}

/** Writes events to the outbox in the caller's transaction (ADR 0010). The worker relays them. */
export const enqueueEvents = async (tx: Tx, orgId: string | null, events: DomainEvent[]): Promise<void> => {
  if (events.length === 0) return;
  await tx.outboxEvent.createMany({
    data: events.map((e) => ({
      id: newId(),
      orgId,
      type: e.type,
      aggregateType: e.aggregateType,
      aggregateId: e.aggregateId,
      payload: e.payload,
    })),
  });
};
