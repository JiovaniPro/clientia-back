import type { ScopedPrismaClient } from "../db/scopedClient.js";
import type { Prisma } from "../generated/prisma/client.js";
import type { AuditAction } from "../generated/prisma/enums.js";

interface AuditLogInput {
  /** Absent pour une action déclenchée par un Super Admin (§5.29) — il n'existe pas
   * en tant que `User`, la colonne `AuditLog.userId` est nullable pour ce cas précis.
   * Précise alors `meta.platformAdminId`/`meta.platformAdminEmail` pour tracer l'acteur. */
  userId?: string;
  action: AuditAction;
  entity?: string;
  entityId?: string;
  meta?: Prisma.InputJsonValue;
}

/** Écrit une ligne d'audit via le client déjà scopé (organizationId injecté automatiquement). */
export async function recordAuditLog(db: ScopedPrismaClient, input: AuditLogInput) {
  await db.auditLog.create({
    data: {
      userId: input.userId ?? null,
      action: input.action,
      entity: input.entity ?? null,
      entityId: input.entityId ?? null,
      ...(input.meta ? { meta: input.meta } : {}),
    },
  });
}
