import type { RecordEvent } from "@casitrace/contracts";
import type { ErrorDetail } from "@casitrace/shared";

const MAX_FUTURE_MS = 10 * 60_000;
const EARLIEST = Date.parse("2000-01-01T00:00:00Z");

/** Structural rules per event type (independent of the database). Returns every problem found. */
export const eventShapeIssues = (e: RecordEvent, now: Date): ErrorDetail[] => {
  const issues: ErrorDetail[] = [];
  const need = (cond: boolean, path: string, message: string) => {
    if (!cond) issues.push({ path, message });
  };
  const at = Date.parse(e.occurredAt);
  need(at <= now.getTime() + MAX_FUTURE_MS, "occurredAt", "Cannot be in the future");
  need(at >= EARLIEST, "occurredAt", "Too far in the past");

  const lotIds = e.inputs.map((i) => i.lotId);
  need(new Set(lotIds).size === lotIds.length, "inputs", "Each input lot may appear only once");

  switch (e.type) {
    case "ORIGINATE":
      need(e.inputs.length === 0, "inputs", "An origin event has no inputs");
      need(e.outputs.length >= 1, "outputs", "Add the harvested or produced lot");
      need(!e.adjust, "adjust", "Not allowed here");
      if (e.process === "harvest") need(!!e.locationId, "locationId", "Say which plot or farm was harvested");
      need(!e.process || e.process === "harvest" || e.process === "other", "process", "Use harvest or other");
      break;
    case "RECEIVE":
      need(e.inputs.length === 0, "inputs", "A receipt creates lots; it has no inputs");
      need(e.outputs.length >= 1, "outputs", "Add the received lot");
      need(!!e.partnerId, "partnerId", "Say who delivered it");
      need(!e.adjust, "adjust", "Not allowed here");
      break;
    case "TRANSFORM":
      need(e.inputs.length >= 1, "inputs", "A transformation consumes at least one lot");
      need(e.outputs.length >= 1, "outputs", "A transformation produces at least one lot");
      need(
        !!e.process && e.process !== "harvest",
        "process",
        "Say what was done: milling, blending, bottling, split or other",
      );
      need(!e.adjust, "adjust", "Not allowed here");
      if (e.process === "split")
        need(
          e.inputs.length === 1 && e.outputs.length >= 2,
          "outputs",
          "A split takes one lot into two or more",
        );
      if (e.process === "blending") need(e.inputs.length >= 2, "inputs", "A blend combines two or more lots");
      break;
    case "SHIP":
      need(e.inputs.length >= 1, "inputs", "Add the lots shipped");
      need(e.outputs.length === 0, "outputs", "A shipment creates no lots");
      need(!!e.partnerId, "partnerId", "Say who it was shipped to");
      need(!e.adjust, "adjust", "Not allowed here");
      break;
    case "ADJUST":
      need(!!e.adjust, "adjust", "Give the lot and the change in quantity");
      need(e.inputs.length === 0 && e.outputs.length === 0, "inputs", "An adjustment changes one lot only");
      break;
  }
  return issues;
};

/** Lot codes: SKU + date + 4 random characters, e.g. EVO-BULK-261110-7K3F. */
export const generateLotCode = (sku: string, at: Date) => {
  const d = at.toISOString().slice(2, 10).replaceAll("-", "");
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const rand = Array.from(
    crypto.getRandomValues(new Uint8Array(4)),
    (b) => alphabet[b % alphabet.length],
  ).join("");
  return `${sku.slice(0, 30)}-${d}-${rand}`;
};
