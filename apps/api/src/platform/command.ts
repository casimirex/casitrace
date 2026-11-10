import type { Db, Tx } from "@casitrace/db";
import { type AuditEntry, type CommandContext, writeAudit } from "./audit";
import { type DomainEvent, enqueueEvents } from "./outbox";

/**
 * What a command handler must return. `audit` is required and non-empty, so a state-changing command
 * cannot be written without an audit record (NFR: 100 % of commands audited).
 */
export interface CommandOutcome<R> {
  result: R;
  audit: [AuditEntry, ...AuditEntry[]];
  events?: DomainEvent[];
}

/**
 * Runs a state-changing command in one database transaction: the handler's writes, its audit records
 * and its outbox events commit together or not at all.
 */
export const runCommand = async <R>(
  db: Db,
  ctx: CommandContext,
  handler: (tx: Tx) => Promise<CommandOutcome<R>>,
): Promise<R> =>
  db.$transaction(async (tx) => {
    const outcome = await handler(tx);
    await writeAudit(tx, ctx, outcome.audit);
    await enqueueEvents(tx, ctx.orgId, outcome.events ?? []);
    return outcome.result;
  });
