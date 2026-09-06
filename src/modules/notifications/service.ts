import type { ScopedPrismaClient } from "../../db/scopedClient.js";
import { NotFound } from "../../lib/httpError.js";
import type { AuthenticatedUser } from "../../types/express.js";
import type { ListNotificationsQuery } from "./schema.js";

export async function listNotifications(
  db: ScopedPrismaClient,
  user: AuthenticatedUser,
  query: ListNotificationsQuery,
) {
  const where: Record<string, unknown> = { userId: user.id };
  if (query.unreadOnly) where.readAt = null;

  const [items, unreadCount] = await db.$transaction([
    db.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    db.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);

  return { items, unreadCount, page: query.page, pageSize: query.pageSize };
}

export async function markAsRead(db: ScopedPrismaClient, user: AuthenticatedUser, id: string) {
  const existing = await db.notification.findUnique({ where: { id } });
  if (!existing || existing.userId !== user.id) throw NotFound("Notification introuvable");
  return db.notification.update({ where: { id }, data: { readAt: new Date() } });
}

export async function markAllAsRead(db: ScopedPrismaClient, user: AuthenticatedUser) {
  await db.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
}
