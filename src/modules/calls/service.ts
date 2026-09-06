import type { ScopedPrismaClient } from "../../db/scopedClient.js";
import { recordAuditLog } from "../../lib/auditLog.js";
import { createConfigService } from "../../lib/configService.js";
import { AuditAction } from "../../generated/prisma/enums.js";
import { BadRequest, Conflict, Forbidden, NotFound } from "../../lib/httpError.js";
import type { AuthenticatedUser } from "../../types/express.js";
import type { ImportRow } from "./import.js";
import type { ChangeCallStatusInput, CreateCallInput, ListCallsQuery, UpdateCallInput } from "./schema.js";

const CALL_STATUS_LIST_KEY = "CALL_STATUS";

/**
 * Code d'erreur stable renvoyé dans `details.code` quand un statut avec
 * `metadata.triggersClientDossierCreation` est demandé sur un appel qui n'a pas
 * encore de dossier client (§P0.2) — le front s'appuie sur cette valeur exacte
 * pour déclencher la cascade (ouvrir la création de dossier puis rejouer la
 * sauvegarde du statut), pas sur le libellé du message qui peut changer.
 */
export const CLIENT_DOSSIER_REQUIRED_CODE = "CLIENT_DOSSIER_REQUIRED";

function canViewAll(user: AuthenticatedUser): boolean {
  return user.permissions.includes("calls.viewAll");
}

export async function createCall(db: ScopedPrismaClient, user: AuthenticatedUser, input: CreateCallInput) {
  const config = createConfigService(db);
  const status = await config.getItemOrThrow(CALL_STATUS_LIST_KEY, input.statusKey);
  const behavior = (status.metadata as Record<string, boolean> | null) ?? {};

  if (behavior.requiresRecallDate && !input.recallDate) {
    throw BadRequest("Ce statut d'appel exige une date de rappel");
  }

  const call = await db.call.create({
    data: {
      organizationId: user.organizationId,
      userId: user.id,
      direction: input.direction,
      type: input.type,
      statusId: status.id,
      // waveNumber reste null : c'est un appel saisi manuellement, pas issu d'un import.
      fromNumber: input.fromNumber,
      toNumber: input.toNumber,
      durationSec: input.durationSec ?? null,
      notes: input.notes ?? null,
      occurredAt: input.occurredAt,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      email: input.email ?? null,
      recallDate: input.recallDate ?? null,
      recallTimeSlot: input.recallTimeSlot ?? null,
    },
  });

  await recordAuditLog(db, { userId: user.id, action: AuditAction.CALL_CREATED, entity: "Call", entityId: call.id });

  return { call, triggersClientDossierCreation: Boolean(behavior.triggersClientDossierCreation) };
}

export async function listCalls(db: ScopedPrismaClient, user: AuthenticatedUser, query: ListCallsQuery) {
  const config = createConfigService(db);
  const [statusFilter, excludeStatusFilter] = await Promise.all([
    query.statusKey ? config.getItemOrThrow(CALL_STATUS_LIST_KEY, query.statusKey) : null,
    query.excludeStatusKey ? config.getItemOrThrow(CALL_STATUS_LIST_KEY, query.excludeStatusKey) : null,
  ]);

  const where: Record<string, unknown> = {};
  if (!canViewAll(user)) {
    where.userId = user.id;
  }
  if (statusFilter || excludeStatusFilter) {
    where.statusId = {
      ...(statusFilter ? { equals: statusFilter.id } : {}),
      ...(excludeStatusFilter ? { not: excludeStatusFilter.id } : {}),
    };
  }
  if (query.type) where.type = query.type;
  if (query.waveNumber !== undefined) where.waveNumber = query.waveNumber;
  if (query.from || query.to) {
    where.occurredAt = {
      ...(query.from ? { gte: query.from } : {}),
      ...(query.to ? { lte: query.to } : {}),
    };
  }
  if (query.search) {
    where.OR = [
      { firstName: { contains: query.search, mode: "insensitive" } },
      { lastName: { contains: query.search, mode: "insensitive" } },
      { toNumber: { contains: query.search } },
      { notes: { contains: query.search, mode: "insensitive" } },
    ];
  }

  const orderBy =
    query.sort === "queue"
      ? [{ waveNumber: "asc" as const }, { lastName: "asc" as const }, { firstName: "asc" as const }]
      : { occurredAt: "desc" as const };

  const [items, total] = await db.$transaction([
    db.call.findMany({
      where,
      orderBy,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: { status: true, client: { select: { id: true } } },
    }),
    db.call.count({ where }),
  ]);

  return { items, total, page: query.page, pageSize: query.pageSize };
}

export async function getCall(db: ScopedPrismaClient, user: AuthenticatedUser, id: string) {
  const call = await db.call.findUnique({
    where: { id },
    include: {
      status: true,
      client: true,
      statusHistory: {
        orderBy: { changedAt: "desc" },
        include: {
          oldStatus: true,
          newStatus: true,
          changedBy: { select: { id: true, firstName: true, lastName: true } },
        },
      },
    },
  });

  if (!call) throw NotFound("Appel introuvable");
  if (!canViewAll(user) && call.userId !== user.id) throw Forbidden();

  return call;
}

export async function updateCall(db: ScopedPrismaClient, user: AuthenticatedUser, id: string, input: UpdateCallInput) {
  const existing = await getCall(db, user, id);

  const call = await db.call.update({
    where: { id },
    data: {
      notes: input.notes ?? existing.notes,
      firstName: input.firstName ?? existing.firstName,
      lastName: input.lastName ?? existing.lastName,
      email: input.email ?? existing.email,
      recallDate: input.recallDate ?? existing.recallDate,
      recallTimeSlot: input.recallTimeSlot ?? existing.recallTimeSlot,
    },
  });

  await recordAuditLog(db, { userId: user.id, action: AuditAction.CALL_UPDATED, entity: "Call", entityId: id });
  return call;
}

export async function changeCallStatus(
  db: ScopedPrismaClient,
  user: AuthenticatedUser,
  id: string,
  input: ChangeCallStatusInput,
) {
  const call = await getCall(db, user, id);
  const config = createConfigService(db);
  const newStatus = await config.getItemOrThrow(CALL_STATUS_LIST_KEY, input.statusKey);
  const behavior = (newStatus.metadata as Record<string, boolean> | null) ?? {};

  const recallDate = input.recallDate ?? call.recallDate;
  if (behavior.requiresRecallDate && !recallDate) {
    throw BadRequest("Ce statut d'appel exige une date de rappel");
  }

  // §P0.2 : un statut qui déclenche la création d'un dossier (ex. "RDV pris") ne
  // peut pas être enregistré tant qu'aucun Client n'existe pour cet appel — le
  // front est censé intercepter cette erreur précise (details.code) pour ouvrir la
  // création de dossier puis rejouer cette même sauvegarde de statut.
  if (behavior.triggersClientDossierCreation && !call.client) {
    throw Conflict("Un dossier client est requis pour ce statut", { code: CLIENT_DOSSIER_REQUIRED_CODE });
  }

  const [updatedCall] = await db.$transaction([
    db.call.update({
      where: { id },
      data: {
        statusId: newStatus.id,
        recallDate,
        recallTimeSlot: input.recallTimeSlot ?? call.recallTimeSlot,
      },
    }),
    db.callStatusHistory.create({
      data: { callId: id, oldStatusId: call.statusId, newStatusId: newStatus.id, changedById: user.id },
    }),
  ]);

  await recordAuditLog(db, {
    userId: user.id,
    action: AuditAction.CALL_UPDATED,
    entity: "Call",
    entityId: id,
    meta: { statusKey: input.statusKey },
  });

  return { call: updatedCall, triggersClientDossierCreation: Boolean(behavior.triggersClientDossierCreation) };
}

export async function deleteCall(db: ScopedPrismaClient, user: AuthenticatedUser, id: string) {
  const existing = await db.call.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw NotFound("Appel introuvable");
  await db.call.delete({ where: { id } });
  await recordAuditLog(db, { userId: user.id, action: AuditAction.CALL_DELETED, entity: "Call", entityId: id });
}

export async function importCalls(db: ScopedPrismaClient, user: AuthenticatedUser, rows: ImportRow[]) {
  if (rows.length === 0) {
    throw BadRequest("Aucune ligne exploitable dans le fichier (colonne téléphone requise)");
  }

  const config = createConfigService(db);
  const listItems = await config.getListItems(CALL_STATUS_LIST_KEY);
  const defaultStatus = listItems.find((item) => item.isDefault);
  if (!defaultStatus) {
    throw BadRequest("Aucun statut d'appel par défaut configuré pour cette organisation");
  }

  // waveNumber : immuable une fois défini, propre à chaque utilisateur — vague suivante = max + 1
  const lastWave = await db.call.findFirst({
    where: { userId: user.id, waveNumber: { not: null } },
    orderBy: { waveNumber: "desc" },
    select: { waveNumber: true },
  });
  const waveNumber = (lastWave?.waveNumber ?? 0) + 1;
  const now = new Date();

  await db.call.createMany({
    data: rows.map((row) => ({
      organizationId: user.organizationId,
      userId: user.id,
      direction: "OUTBOUND" as const,
      type: "PROSPECTION" as const,
      statusId: defaultStatus.id,
      waveNumber,
      fromNumber: "", // numéro sortant de l'organisation, non connu à l'import
      toNumber: row.phoneNumber,
      occurredAt: now,
      firstName: row.firstName ?? null,
      lastName: row.lastName ?? null,
      email: row.email ?? null,
    })),
  });

  await recordAuditLog(db, {
    userId: user.id,
    action: AuditAction.CALL_IMPORTED,
    entity: "Call",
    meta: { waveNumber, count: rows.length },
  });

  return { waveNumber, count: rows.length };
}
