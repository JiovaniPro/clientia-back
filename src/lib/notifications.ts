import type { ScopedPrismaClient } from "../db/scopedClient.js";
import type { Prisma } from "../generated/prisma/client.js";
import type { NotificationType } from "../generated/prisma/enums.js";

interface CreateNotificationInput {
  organizationId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  meta?: Prisma.InputJsonValue;
}

/**
 * Créateur interne, consommé par les autres modules/jobs (ex: rappel arrivé à échéance,
 * appel assigné, RDV confirmé/refusé) — pas de route de création publique, une
 * notification naît toujours d'un événement métier, jamais d'une saisie libre.
 */
export async function createNotification(db: ScopedPrismaClient, input: CreateNotificationInput) {
  return db.notification.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      ...(input.meta ? { meta: input.meta } : {}),
    },
  });
}
