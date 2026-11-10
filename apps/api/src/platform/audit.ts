import type { Db, Prisma, Tx } from "@casitrace/db";
import { newId } from "@casitrace/shared";

export type ActorType = "user" | "system" | "api_client";

export interface Actor {
  type: ActorType;
  id: string | null;
}

export interface AuditEntry {
  action: string; // "<resource>.<verb>", e.g. "organisation.created"
  resourceType: string;
  resourceId: string | null;
  data?: Prisma.InputJsonValue;
}

export interface CommandContext {
  actor: Actor;
  orgId: string | null;
  requestId: string | null;
}

/** Appends audit rows. The table rejects UPDATE/DELETE (ADR 0007). */
export const writeAudit = async (tx: Tx | Db, ctx: CommandContext, entries: AuditEntry[]): Promise<void> => {
  await tx.auditLog.createMany({
    data: entries.map((e) => ({
      id: newId(),
      orgId: ctx.orgId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.id,
      action: e.action,
      resourceType: e.resourceType,
      resourceId: e.resourceId,
      requestId: ctx.requestId,
      ...(e.data === undefined ? {} : { data: e.data }),
    })),
  });
};
