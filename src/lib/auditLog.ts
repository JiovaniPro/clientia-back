import type { ScopedPrismaClient } from "../db/scopedClient.js";
import type { Prisma } from "../generated/prisma/client.js";
import type { AuditAction } from "../generated/prisma/enums.js";

interface AuditLogInput {
  userId: string;
  action: AuditAction;
  entity?: string;
  entityId?: string;
  meta?: Prisma.InputJsonValue;
}

/** Écrit une ligne d'audit via le client déjà scopé (organizationId injecté automatiquement). */
export async function recordAuditLog(db: ScopedPrismaClient, input: AuditLogInput) {
  await db.auditLog.create({
    data: {
      userId: input.userId,
      action: input.action,
      entity: input.entity ?? null,
      entityId: input.entityId ?? null,
      ...(input.meta ? { meta: input.meta } : {}),
    },
  });
}
