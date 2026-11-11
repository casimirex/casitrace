import { can } from "@casitrace/contracts";
import type { Db } from "@casitrace/db";
import { newId } from "@casitrace/shared";
import type { EventHandler } from "../events";

interface HandoffCreated {
  handoffId: string;
  senderOrgId: string;
  receiverOrgId: string;
  lines: number;
  shared: boolean;
}

/**
 * Tells the receiving organisation that a partner shipped to it and the delivery is waiting to be
 * booked in (audit F-1). Notifies members who may accept handoffs; one email each.
 * Idempotent: the notification dedupe key is the handoff ID, and emails are only queued for
 * notifications this run actually created.
 */
export const createHandoffNotifier =
  (db: Db, webOrigin: string): EventHandler =>
  async (event) => {
    const p = event.payload as HandoffCreated;
    await db.$transaction(async (tx) => {
      // Reads the sender's name (another organisation) and the receiver's members: platform scope,
      // writes stay inside the receiver (the event's org_id).
      await tx.$executeRaw`SELECT set_config('app.platform_access', 'on', true)`;
      const sender = await tx.organization.findUnique({
        where: { id: p.senderOrgId },
        select: { name: true },
      });
      const members = await tx.member.findMany({
        where: { organizationId: p.receiverOrgId },
        include: { user: { select: { id: true, email: true, name: true } } },
      });
      const senderName = sender?.name ?? "A supplier";
      const items = p.lines === 1 ? "1 lot" : `${p.lines} lots`;
      const title = `Delivery from ${senderName} to book in`;
      const body = `${senderName} shipped ${items} to you${p.shared ? " and shared the history" : ""}. Check it and book it in, or dispute it.`;
      const link = `/orgs/${p.receiverOrgId}/shipments`;
      for (const m of members.filter((x) => can(x.role, "handoff:accept"))) {
        const created = await tx.notification.createMany({
          data: [
            {
              id: newId(),
              userId: m.user.id,
              orgId: p.receiverOrgId,
              kind: "handoff.received",
              title,
              body,
              link,
              dedupeKey: `handoff:${p.handoffId}`,
            },
          ],
          skipDuplicates: true,
        });
        if (!created.count) continue;
        const emailId = newId();
        await tx.outboxEvent.create({
          data: {
            id: emailId,
            orgId: p.receiverOrgId,
            type: "email.requested",
            aggregateType: "email",
            aggregateId: emailId,
            payload: {
              template: "notice",
              to: m.user.email,
              data: { name: m.user.name, title, body, url: `${webOrigin}${link}` },
            },
          },
        });
      }
    });
  };
