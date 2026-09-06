import bcrypt from "bcryptjs";
import { prisma } from "../../db/prisma.js";
import type { ScopedPrismaClient } from "../../db/scopedClient.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { AuditAction } from "../../generated/prisma/enums.js";
import { recordAuditLog } from "../../lib/auditLog.js";
import { ADMINISTRATOR_ROLE_NAME } from "../../lib/defaultRoles.js";
import { Conflict, NotFound } from "../../lib/httpError.js";
import type { AuthenticatedUser } from "../../types/express.js";
import { provisionDefaultOrganizationData } from "./defaultData.js";
import type { CreateOrganizationInput, UpdateOrganizationInput } from "./schema.js";

/**
 * Créée hors du client scopé (l'organisation n'existe pas encore) : c'est, avec le
 * module `platform`, l'un des seuls endroits autorisés à écrire via `db/prisma.ts`
 * directement (voir §2 du plan).
 */
export async function createOrganization(input: CreateOrganizationInput) {
  const existing = await prisma.organization.findUnique({ where: { slug: input.organizationSlug } });
  if (existing) {
    throw Conflict("Cet identifiant d'espace de travail est déjà utilisé");
  }

  const hashedPassword = await bcrypt.hash(input.adminPassword, 10);

  return prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: { name: input.organizationName, slug: input.organizationSlug },
    });

    await provisionDefaultOrganizationData(tx, organization.id);

    const adminRole = await tx.role.findFirstOrThrow({
      where: { organizationId: organization.id, name: ADMINISTRATOR_ROLE_NAME },
    });

    const adminUser = await tx.user.create({
      data: {
        organizationId: organization.id,
        email: input.adminEmail,
        password: hashedPassword,
        firstName: input.adminFirstName ?? null,
        lastName: input.adminLastName ?? null,
        roleId: adminRole.id,
      },
    });

    return { organization, adminUser };
  });
}

/**
 * `Organization` n'est pas dans TENANT_SCOPED_MODELS (elle EST le tenant, pas une
 * table qui lui appartient) — le client scopé ne filtre donc rien ici automatiquement,
 * d'où le `where: { id: organizationId }` explicite.
 */
export async function getCurrentOrganization(db: ScopedPrismaClient, organizationId: string) {
  const organization = await db.organization.findUnique({ where: { id: organizationId } });
  if (!organization) throw NotFound("Organisation introuvable");
  return organization;
}

export async function updateCurrentOrganization(
  db: ScopedPrismaClient,
  user: AuthenticatedUser,
  input: UpdateOrganizationInput,
) {
  const data: Prisma.OrganizationUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.logoUrl !== undefined) data.logoUrl = input.logoUrl;
  if (input.primaryColor !== undefined) data.primaryColor = input.primaryColor;

  const organization = await db.organization.update({ where: { id: user.organizationId }, data });

  await recordAuditLog(db, {
    userId: user.id,
    action: AuditAction.ORGANIZATION_UPDATED,
    entity: "Organization",
    entityId: organization.id,
  });

  return organization;
}
