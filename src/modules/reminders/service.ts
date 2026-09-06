import type { ScopedPrismaClient } from "../../db/scopedClient.js";
import { AuditAction } from "../../generated/prisma/enums.js";
import { recordAuditLog } from "../../lib/auditLog.js";
import { NotFound } from "../../lib/httpError.js";
import type { AuthenticatedUser } from "../../types/express.js";
import type { CreateReminderInput, ListRemindersQuery, UpdateReminderInput } from "./schema.js";

/** Les rappels sont des tâches personnelles — toujours scopés au créateur, pas de vue "tous". */

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
  const where: Record<string, unknown> = { userId: user.id };
  if (query.status) where.status = query.status;
  if (query.from || query.to) {
    where.dueAt = { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) };
  }
  return db.reminder.findMany({ where, orderBy: { dueAt: "asc" } });
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
