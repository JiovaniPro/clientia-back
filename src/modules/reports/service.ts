import type { ScopedPrismaClient } from "../../db/scopedClient.js";
import type { ReportsRangeQuery } from "./schema.js";

export async function getCallsReport(db: ScopedPrismaClient, query: ReportsRangeQuery) {
  const where = { occurredAt: { gte: query.from, lte: query.to } };

  const [total, byStatus, byType, byUser] = await Promise.all([
    db.call.count({ where }),
    db.call.groupBy({ by: ["statusId"], where, _count: { _all: true } }),
    db.call.groupBy({ by: ["type"], where, _count: { _all: true } }),
    db.call.groupBy({ by: ["userId"], where, _count: { _all: true } }),
  ]);

  const statusIds = byStatus.map((s) => s.statusId);
  const statusItems =
    statusIds.length > 0 ? await db.configurableListItem.findMany({ where: { id: { in: statusIds } } }) : [];
  const statusLabelById = new Map(statusItems.map((s) => [s.id, s.label]));

  const userIds = byUser.map((u) => u.userId);
  const users =
    userIds.length > 0
      ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true } })
      : [];
  const userById = new Map(users.map((u) => [u.id, u]));

  return {
    total,
    byStatus: byStatus.map((s) => ({
      statusId: s.statusId,
      label: statusLabelById.get(s.statusId) ?? s.statusId,
      count: s._count._all,
    })),
    byType: byType.map((t) => ({ type: t.type, count: t._count._all })),
    byUser: byUser.map((u) => ({ userId: u.userId, user: userById.get(u.userId) ?? null, count: u._count._all })),
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

export async function getAppointmentsReport(db: ScopedPrismaClient, query: ReportsRangeQuery) {
  const where = { type: "APPOINTMENT" as const, startAt: { gte: query.from, lte: query.to } };

  const [total, byStatus] = await Promise.all([
    db.calendarEvent.count({ where }),
    db.calendarEvent.groupBy({ by: ["status"], where, _count: { _all: true } }),
  ]);

  return {
    total,
    byStatus: byStatus.map((s) => ({ status: s.status, count: s._count._all })),
  };
}
