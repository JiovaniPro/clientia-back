import type { ScopedPrismaClient } from "../../db/scopedClient.js";
import { AuditAction } from "../../generated/prisma/enums.js";
import { BadRequest } from "../../lib/httpError.js";
import type { ListAuditLogsQuery } from "./schema.js";

const VALID_ACTIONS = new Set<string>(Object.values(AuditAction));

export async function listAuditLogs(db: ScopedPrismaClient, query: ListAuditLogsQuery) {
  const where: Record<string, unknown> = {};

  if (query.userId) where.userId = query.userId;
  if (query.entity) where.entity = query.entity;
  if (query.action) {
    if (!VALID_ACTIONS.has(query.action)) {
      throw BadRequest(`Action d'audit inconnue : ${query.action}`);
    }
    where.action = query.action;
  }
  if (query.from || query.to) {
    where.createdAt = {
      ...(query.from ? { gte: query.from } : {}),
      ...(query.to ? { lte: query.to } : {}),
    };
  }

  const [items, total] = await db.$transaction([
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
    }),
    db.auditLog.count({ where }),
  ]);

  return { items, total, page: query.page, pageSize: query.pageSize };
}
