import type { components } from "@casitrace/api-client";
import { ApiError, api, unwrap } from "../../lib/api";

type RecordEvent = components["schemas"]["RecordEvent"];
export interface QueuedEvent {
  orgId: string;
  body: RecordEvent & { idempotencyKey: string };
  label: string;
  queuedAt: string;
  lastError?: string;
}

const KEY = "casitrace.offline-events";
const read = (): QueuedEvent[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as QueuedEvent[];
  } catch {
    return [];
  }
};
const write = (q: QueuedEvent[]) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(q));
  } catch {
    /* storage full or blocked: the queue lives in memory for this page only */
  }
  window.dispatchEvent(new Event("casitrace-queue"));
};

export const queued = (orgId: string) => read().filter((q) => q.orgId === orgId);

/**
 * Sends an event; when the network is unavailable it is queued on this device and sent later.
 * The idempotency key makes the retry safe: the server records it once (roadmap-v2 P5).
 */
export const submitEvent = async (
  orgId: string,
  body: RecordEvent,
  label: string,
): Promise<"sent" | "queued"> => {
  const withKey = { ...body, idempotencyKey: body.idempotencyKey ?? `web-${crypto.randomUUID()}` };
  try {
    unwrap(await api.POST("/v1/orgs/{orgId}/events", { params: { path: { orgId } }, body: withKey }));
    return "sent";
  } catch (e) {
    if (e instanceof ApiError) throw e; // the server answered: show the problem, do not queue
    write([...read(), { orgId, body: withKey, label, queuedAt: new Date().toISOString() }]);
    return "queued";
  }
};

/** Retries queued events in order. Rejected ones stay with their error so the user can see them. */
export const flushQueue = async () => {
  const items = read();
  const remaining: QueuedEvent[] = [];
  for (const item of items) {
    try {
      unwrap(
        await api.POST("/v1/orgs/{orgId}/events", {
          params: { path: { orgId: item.orgId } },
          body: item.body,
        }),
      );
    } catch (e) {
      remaining.push({ ...item, lastError: e instanceof ApiError ? e.message : "Still offline" });
      if (!(e instanceof ApiError)) {
        remaining.push(...items.slice(items.indexOf(item) + 1));
        break;
      }
    }
  }
  write(remaining);
  return { sent: items.length - remaining.length, remaining: remaining.length };
};

export const discardQueued = (key: string) => write(read().filter((q) => q.body.idempotencyKey !== key));

if (typeof window !== "undefined") window.addEventListener("online", () => void flushQueue());
