import type { ScopedPrismaClient } from "../../db/scopedClient.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { AuditAction } from "../../generated/prisma/enums.js";
import { recordAuditLog } from "../../lib/auditLog.js";
import type { AuthenticatedUser } from "../../types/express.js";

/** Préférences personnelles (clé/valeur libre) — toujours scopées à l'utilisateur courant. */

export async function listSettings(db: ScopedPrismaClient, user: AuthenticatedUser) {
  return db.setting.findMany({ where: { userId: user.id } });
}

export async function upsertSetting(
  db: ScopedPrismaClient,
  user: AuthenticatedUser,
  key: string,
  value: Prisma.InputJsonValue,
) {
  const setting = await db.setting.upsert({
    where: { userId_key: { userId: user.id, key } },
    create: { organizationId: user.organizationId, userId: user.id, key, value },
    update: { value },
  });

  await recordAuditLog(db, {
    userId: user.id,
    action: AuditAction.SETTINGS_UPDATED,
    entity: "Setting",
    entityId: setting.id,
    meta: { key },
  });

  return setting;
}
