import { prisma } from "../../../db/prisma.js";
import { getScopedClient } from "../../../db/scopedClient.js";
import { AuditAction } from "../../../generated/prisma/enums.js";
import { recordAuditLog } from "../../../lib/auditLog.js";
import { NotFound } from "../../../lib/httpError.js";
import type { AuthenticatedPlatformAdmin } from "../../../types/express.js";
import type { CreateOrganizationInput } from "../../organizations/schema.js";
import * as organizationsService from "../../organizations/service.js";
import type { SetOrganizationStatusInput } from "./schema.js";

/**
 * Toujours via `prisma` non scopé — un Super Admin n'a pas d'organizationId,
 * `getScopedClient` ne s'applique pas à lui (voir §5.29, point 5 de la proposition).
 * `getScopedClient(organizationId)` est en revanche construit ad hoc quand une
 * action cible une organisation PRÉCISE, uniquement pour que `recordAuditLog`
 * écrive dans le bon journal (même pattern que confirmPasswordReset).
 */
export async function listOrganizations() {
  return prisma.organization.findMany({
    include: { _count: { select: { users: true } } },
    orderBy: { createdAt: "desc" },
  });
}

export async function getOrganization(id: string) {
  const organization = await prisma.organization.findUnique({
    where: { id },
    include: {
      _count: { select: { users: true } },
      users: {
        select: { id: true, email: true, firstName: true, lastName: true, isActive: true, role: { select: { name: true } } },
        orderBy: { email: "asc" },
      },
    },
  });
  if (!organization) throw NotFound("Organisation introuvable");
  return organization;
}

export async function createOrganization(input: CreateOrganizationInput, platformAdmin: AuthenticatedPlatformAdmin) {
  const { organization } = await organizationsService.createOrganization(input, {
    type: "platform_admin",
    platformAdminId: platformAdmin.id,
    platformAdminEmail: platformAdmin.email,
  });
  return getOrganization(organization.id);
}

/**
 * Suspendre : `isActive: false` bloque déjà tout appel API au plus tard à la
 * prochaine requête (authMiddleware revérifie en base à chaque fois, voir §5.29
 * sous-lot 1), mais on révoque EN PLUS toutes les sessions actives de l'organisation
 * — décision tranchée explicitement avec l'utilisateur : "suspendu" doit vouloir dire
 * coupé immédiatement, pas seulement au prochain appel API avec l'access token en
 * cours (qui, lui, reste valide jusqu'à 15 minutes). Réactiver ne restaure rien à
 * reconstruire : aucune donnée n'a été touchée, juste le drapeau.
 */
export async function setOrganizationStatus(
  id: string,
  input: SetOrganizationStatusInput,
  platformAdmin: AuthenticatedPlatformAdmin,
) {
  const existing = await prisma.organization.findUnique({ where: { id } });
  if (!existing) throw NotFound("Organisation introuvable");

  await prisma.$transaction(async (tx) => {
    await tx.organization.update({ where: { id }, data: { isActive: input.isActive } });
    if (!input.isActive) {
      await tx.session.updateMany({
        where: { user: { organizationId: id }, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
  });

  const db = getScopedClient(id);
  await recordAuditLog(db, {
    action: input.isActive ? AuditAction.ORGANIZATION_ACTIVATED : AuditAction.ORGANIZATION_DEACTIVATED,
    entity: "Organization",
    entityId: id,
    meta: { triggeredBy: "platform_admin", platformAdminId: platformAdmin.id, platformAdminEmail: platformAdmin.email },
  });

  return getOrganization(id);
}
