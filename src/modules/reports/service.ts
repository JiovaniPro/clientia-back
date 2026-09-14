import type { ScopedPrismaClient } from "../../db/scopedClient.js";
import type { AuthenticatedUser } from "../../types/express.js";
import type { ReportsRangeQuery } from "./schema.js";

/** Même patron que clients/service.ts et calls/service.ts::canViewAll. */
function canViewAll(user: AuthenticatedUser): boolean {
  return user.permissions.includes("reports.viewAll");
}

/**
 * Sans `reports.viewAll`, l'appelant est TOUJOURS ramené à son propre id — un
 * `userId` différent dans la requête est ignoré, jamais fait confiance (§5.17,
 * point 3 de la proposition : la portée est décidée ici, pas côté client).
 */
function resolveUserIdFilter(user: AuthenticatedUser, requestedUserId: string | undefined): string | undefined {
  if (canViewAll(user)) return requestedUserId;
  return user.id;
}

export async function getCallsReport(db: ScopedPrismaClient, user: AuthenticatedUser, query: ReportsRangeQuery) {
  const userId = resolveUserIdFilter(user, query.userId);
  const where = {
    occurredAt: { gte: query.from, lte: query.to },
    ...(userId ? { userId } : {}),
  };

  const [total, byStatus, byType, byDirection, byUser] = await Promise.all([
    db.call.count({ where }),
    db.call.groupBy({ by: ["statusId"], where, _count: { _all: true } }),
    db.call.groupBy({ by: ["type"], where, _count: { _all: true } }),
    db.call.groupBy({ by: ["direction"], where, _count: { _all: true } }),
    db.call.groupBy({ by: ["userId"], where, _count: { _all: true } }),
  ]);

  const statusIds = byStatus.map((s) => s.statusId);
  const statusItems =
    statusIds.length > 0
      ? await db.configurableListItem.findMany({ where: { id: { in: statusIds } } })
      : [];
  const statusById = new Map(statusItems.map((s) => [s.id, s]));

  const userIds = byUser.map((u) => u.userId);
  const users =
    userIds.length > 0
      ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true } })
      : [];
  const userById = new Map(users.map((u) => [u.id, u]));

  // Taux de conversion (§5.15, option B retenue avec l'utilisateur) : basé sur le
  // MÊME drapeau comportemental qui déclenche réellement la création d'un dossier
  // client (calls/service.ts) — pas une approximation temporelle (RDV créés / appels
  // sur la période), qui mélangerait des appels et des RDV de jours différents.
  const triggeringCount = byStatus.reduce((sum, s) => {
    const metadata = statusById.get(s.statusId)?.metadata as Record<string, boolean> | null | undefined;
    return metadata?.triggersClientDossierCreation ? sum + s._count._all : sum;
  }, 0);

  return {
    total,
    byStatus: byStatus.map((s) => ({
      statusId: s.statusId,
      label: statusById.get(s.statusId)?.label ?? s.statusId,
      count: s._count._all,
    })),
    byType: byType.map((t) => ({ type: t.type, count: t._count._all })),
    byDirection: byDirection.map((d) => ({ direction: d.direction, count: d._count._all })),
    byUser: byUser.map((u) => ({ userId: u.userId, user: userById.get(u.userId) ?? null, count: u._count._all })),
    conversion: {
      triggeringCount,
      rate: total > 0 ? triggeringCount / total : 0,
    },
  };
}

export async function getClientsReport(db: ScopedPrismaClient, query: ReportsRangeQuery) {
  const where = { createdAt: { gte: query.from, lte: query.to } };

  const [total, byDossierStatus, byFinalStatus] = await Promise.all([
    db.client.count({ where }),
    db.client.groupBy({ by: ["dossierStatusId"], where, _count: { _all: true } }),
    db.client.groupBy({ by: ["finalStatusId"], where, _count: { _all: true } }),
  ]);

  const statusIds = [
    ...new Set([...byDossierStatus.map((s) => s.dossierStatusId), ...byFinalStatus.map((s) => s.finalStatusId)]),
  ];
  const statusItems =
    statusIds.length > 0 ? await db.configurableListItem.findMany({ where: { id: { in: statusIds } } }) : [];
  const labelById = new Map(statusItems.map((s) => [s.id, s.label]));

  return {
    total,
    byDossierStatus: byDossierStatus.map((s) => ({
      statusId: s.dossierStatusId,
      label: labelById.get(s.dossierStatusId) ?? s.dossierStatusId,
      count: s._count._all,
    })),
    byFinalStatus: byFinalStatus.map((s) => ({
      statusId: s.finalStatusId,
      label: labelById.get(s.finalStatusId) ?? s.finalStatusId,
      count: s._count._all,
    })),
  };
}

export async function getAppointmentsReport(
  db: ScopedPrismaClient,
  user: AuthenticatedUser,
  query: ReportsRangeQuery,
) {
  // "Agent" pour un RDV = agentRdvId (l'agent assigné), pas l'organisateur de
  // l'événement — c'est la notion déjà utilisée partout ailleurs dans calendar/service.ts.
  const agentRdvId = resolveUserIdFilter(user, query.userId);
  const where = {
    type: "APPOINTMENT" as const,
    startAt: { gte: query.from, lte: query.to },
    ...(agentRdvId ? { agentRdvId } : {}),
  };

  const [total, byStatus] = await Promise.all([
    db.calendarEvent.count({ where }),
    db.calendarEvent.groupBy({ by: ["status"], where, _count: { _all: true } }),
  ]);

  return {
    total,
    byStatus: byStatus.map((s) => ({ status: s.status, count: s._count._all })),
  };
}
