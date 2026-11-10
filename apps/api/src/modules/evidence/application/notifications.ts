import type { Db } from "@casitrace/db";
import { AppError } from "@casitrace/shared";

/** Notifications belong to a user; every query filters by user_id (not under tenant RLS). */
export const listNotifications = async (db: Db, userId: string, unreadOnly: boolean) => {
  const [rows, unread] = await Promise.all([
    db.notification.findMany({
      where: { userId, ...(unreadOnly ? { readAt: null } : {}) },
      orderBy: [{ readAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }],
      take: 100,
    }),
    db.notification.count({ where: { userId, readAt: null } }),
  ]);
  return {
    unread,
    items: rows.map((n) => ({
      id: n.id,
      orgId: n.orgId,
      kind: n.kind,
      title: n.title,
      body: n.body,
      link: n.link,
      readAt: n.readAt?.toISOString() ?? null,
      createdAt: n.createdAt.toISOString(),
    })),
  };
};

export const markRead = async (db: Db, userId: string, id: string) => {
  const r = await db.notification.updateMany({
    where: { id, userId, readAt: null },
    data: { readAt: new Date() },
  });
  if (r.count === 0 && !(await db.notification.count({ where: { id, userId } }))) {
    throw new AppError("NOT_FOUND", "Notification not found.");
  }
};

export const markAllRead = async (db: Db, userId: string) =>
  (await db.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } })).count;
