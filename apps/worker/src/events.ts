/** The job payload relayed from one outbox row. Handlers must be idempotent on `eventId` (ADR 0010). */
export interface RelayedEvent {
  eventId: string;
  type: string;
  orgId: string | null;
  aggregateType: string;
  aggregateId: string;
  payload: unknown;
  occurredAt: string;
}

export type EventHandler = (event: RelayedEvent) => Promise<void>;

export const DOMAIN_EVENTS_QUEUE = "domain-events";

/** Maps event types to handlers. Modules register their handlers here from P2 onward. */
export class EventRegistry {
  private readonly handlers = new Map<string, EventHandler[]>();

  on(type: string, handler: EventHandler): this {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]);
    return this;
  }

  async dispatch(event: RelayedEvent): Promise<number> {
    const hs = this.handlers.get(event.type) ?? [];
    for (const h of hs) await h(event);
    return hs.length;
  }
}
