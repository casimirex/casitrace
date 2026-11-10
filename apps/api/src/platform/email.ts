import type { Db } from "@casitrace/db";
import { newId } from "@casitrace/shared";

/** Email templates the worker knows how to render (apps/worker/src/email). */
export type EmailRequest =
  | { template: "verify-email"; to: string; data: { name: string; url: string } }
  | { template: "reset-password"; to: string; data: { name: string; url: string } }
  | {
      template: "invitation";
      to: string;
      data: { organisationName: string; inviterName: string; role: string; url: string };
    };

/**
 * Queues an email through the outbox (ADR 0010); the worker sends it. Never sends inline, so a slow
 * or failing mail server cannot block or fail a request.
 */
export const requestEmail = async (db: Db, email: EmailRequest): Promise<void> => {
  const id = newId();
  await db.outboxEvent.create({
    data: { id, type: "email.requested", aggregateType: "email", aggregateId: id, payload: email },
  });
};
