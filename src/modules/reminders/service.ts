import type { ScopedPrismaClient } from "../../db/scopedClient.js";
import { AuditAction } from "../../generated/prisma/enums.js";
import { recordAuditLog } from "../../lib/auditLog.js";
import { NotFound } from "../../lib/httpError.js";
import type { AuthenticatedUser } from "../../types/express.js";
import type { CreateReminderInput, ListRemindersQuery, UpdateReminderInput } from "./schema.js";

/**
 * §5.19 — `reminders.viewAll` permet à un admin de superviser les rappels liés à
 * un appel/client, mais ne doit JAMAIS donner accès aux pense-bêtes purement
 * personnels (`callId: null`) d'un AUTRE utilisateur — décision explicite de
 * l'utilisateur : ce sont deux catégories différentes (supervision légitime vs
 * espace privé de l'agent). La garantie est structurelle dans `listReminders`
 * (voir ci-dessous), pas un simple filtre optionnel côté écran : même sans passer
 * `userId`, la vue "toute l'organisation" exclut déjà les rappels personnels des
 * autres — elle ne montre que les siens propres (tous) + les rappels liés de
 * n'importe qui. Écriture (`updateReminder`/`deleteReminder`) volontairement PAS
 * étendue par ce sous-lot — superviser n'est pas éditer les tâches de quelqu'un
 * d'autre, non demandé.
 */
function canViewAll(user: AuthenticatedUser): boolean {
  return user.permissions.includes("reminders.viewAll");
}

export async function createReminder(db: ScopedPrismaClient, user: AuthenticatedUser, input: CreateReminderInput) {
  const reminder = await db.reminder.create({
    data: {
      organizationId: user.organizationId,
      userId: user.id,
      callId: input.callId ?? null,
      title: input.title,
      description: input.description ?? null,
      dueAt: input.dueAt,
    },
  });
  await recordAuditLog(db, { userId: user.id, action: AuditAction.REMINDER_CREATED, entity: "Reminder", entityId: reminder.id });
  return reminder;
}

export async function listReminders(db: ScopedPrismaClient, user: AuthenticatedUser, query: ListRemindersQuery) {
  const where: Record<string, unknown> = {};

  if (!canViewAll(user)) {
    where.userId = user.id;
  } else if (query.userId && query.userId !== user.id) {
    // Un agent précis, différent de soi — jamais ses rappels personnels.
    where.userId = query.userId;
    where.callId = { not: null };
  } else if (query.userId === user.id) {
    where.userId = user.id; // soi-même explicitement — personnels + liés, comme d'habitude
  } else {
    // Vue globale (aucun agent précisé) : mes propres rappels (tous) + les
    // rappels LIÉS de n'importe qui — jamais les personnels des autres.
    where.OR = [{ userId: user.id }, { callId: { not: null } }];
  }

  if (query.status) where.status = query.status;
  if (query.from || query.to) {
    where.dueAt = { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) };
  }
  return db.reminder.findMany({
    where,
    orderBy: { dueAt: "asc" },
    include: { user: { select: { id: true, firstName: true, lastName: true } } },
  });
}

export async function updateReminder(
  db: ScopedPrismaClient,
  user: AuthenticatedUser,
  id: string,
  input: UpdateReminderInput,
) {
  const existing = await db.reminder.findUnique({ where: { id } });
  if (!existing || existing.userId !== user.id) throw NotFound("Rappel introuvable");

  const reminder = await db.reminder.update({
    where: { id },
    data: {
      title: input.title ?? existing.title,
      description: input.description ?? existing.description,
      dueAt: input.dueAt ?? existing.dueAt,
      status: input.status ?? existing.status,
    },
  });
  await recordAuditLog(db, { userId: user.id, action: AuditAction.REMINDER_UPDATED, entity: "Reminder", entityId: id });
  return reminder;
}

export async function deleteReminder(db: ScopedPrismaClient, user: AuthenticatedUser, id: string) {
  const existing = await db.reminder.findUnique({ where: { id } });
  if (!existing || existing.userId !== user.id) throw NotFound("Rappel introuvable");
  await db.reminder.delete({ where: { id } });
  await recordAuditLog(db, { userId: user.id, action: AuditAction.REMINDER_DELETED, entity: "Reminder", entityId: id });
}
