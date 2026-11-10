import { PgBoss } from "pg-boss";
import { DOMAIN_EVENTS_QUEUE, type EventRegistry, type RelayedEvent } from "./events";
import type { EventSink } from "./outbox-relay";

export const createBoss = (connectionString: string) => new PgBoss({ connectionString, schema: "pgboss" });

export const ensureQueues = async (boss: PgBoss) => {
  await boss.createQueue(`${DOMAIN_EVENTS_QUEUE}-dlq`);
  await boss.createQueue(DOMAIN_EVENTS_QUEUE, {
    retryLimit: 5,
    retryBackoff: true,
    deadLetter: `${DOMAIN_EVENTS_QUEUE}-dlq`,
  });
};

export const bossSink = (boss: PgBoss): EventSink => ({
  async send(event) {
    // singletonKey dedupes a re-sent outbox row while its first job is still queued.
    await boss.send(DOMAIN_EVENTS_QUEUE, event as unknown as object, { singletonKey: event.eventId });
  },
});

/**
 * Consumes domain events. Several local workers run in parallel so one slow job (a virus scan, a
 * burst of recall emails) does not hold up the rest; handlers are idempotent, so this is safe.
 */
export const startConsumers = (
  boss: PgBoss,
  registry: EventRegistry,
  pollingIntervalSeconds = 2,
  localConcurrency = 4,
) =>
  boss.work<RelayedEvent>(DOMAIN_EVENTS_QUEUE, { pollingIntervalSeconds, localConcurrency }, async (jobs) => {
    for (const job of jobs) await registry.dispatch(job.data);
  });
