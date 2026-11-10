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
 * and its outbox events commit together or not at all. When ctx.orgId is set, the transaction is
 * scoped to that organisation for row-level security (ADR 0008).
 */
export const runCommand = async <R>(
  db: Db,
  ctx: CommandContext,
  handler: (tx: Tx) => Promise<CommandOutcome<R>>,
  options: { timeoutMs?: number } = {},
): Promise<R> =>
  db.$transaction(
    async (tx) => {
      if (ctx.orgId) await tx.$executeRaw`SELECT set_config('app.org_id', ${ctx.orgId}, true)`;
      const outcome = await handler(tx);
      await writeAudit(tx, ctx, outcome.audit);
      await enqueueEvents(tx, ctx.orgId, outcome.events ?? []);
      return outcome.result;
    },
    { timeout: options.timeoutMs ?? 10_000, maxWait: 5_000 },
  );
