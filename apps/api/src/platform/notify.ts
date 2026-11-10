import { can, type Permission } from "@casitrace/contracts";
import type { Db, Tx } from "@casitrace/db";
import { newId } from "@casitrace/shared";

/**
 * In-app notification (and email) to the members of an organisation who hold a permission.
 * Used when one organisation's action needs another organisation's attention.
 */
export const notifyOrg = async (
  tx: Tx | Db,
  orgId: string,
  permission: Permission,
  n: { kind: string; title: string; body: string; link: string; dedupeKey: string },
  webOrigin: string,
) => {
  const members = await tx.member.findMany({
    where: { organizationId: orgId },
    include: { user: { select: { id: true, email: true, name: true } } },
  });
  for (const m of members.filter((x) => can(x.role, permission))) {
    const created = await tx.notification.createMany({
      data: [
        {
          id: newId(),
          userId: m.user.id,
          orgId,
          kind: n.kind,
          title: n.title,
          body: n.body,
          link: n.link,
          dedupeKey: n.dedupeKey,
        },
      ],
      skipDuplicates: true,
    });
    if (!created.count) continue;
    const emailId = newId();
    await tx.outboxEvent.create({
      data: {
        id: emailId,
        orgId,
        type: "email.requested",
        aggregateType: "email",
        aggregateId: emailId,
        payload: {
          template: "notice",
          to: m.user.email,
          data: { name: m.user.name, title: n.title, body: n.body, url: `${webOrigin}${n.link}` },
        },
      },
    });
  }
};
