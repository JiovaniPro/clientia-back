import bcrypt from "bcryptjs";
import { prisma } from "../src/db/prisma.js";
import { getScopedClient } from "../src/db/scopedClient.js";
import { ADMINISTRATOR_ROLE_NAME } from "../src/lib/defaultRoles.js";
import { PERMISSIONS_CATALOG } from "../src/lib/permissionsCatalog.js";
import { provisionDefaultOrganizationData } from "../src/modules/organizations/defaultData.js";
import type { AuthenticatedUser } from "../src/types/express.js";

/** Le catalogue `Permission` est global — idempotent, à appeler une fois par run de tests. */
export async function ensurePermissionsSeeded() {
  for (const perm of PERMISSIONS_CATALOG) {
    await prisma.permission.upsert({ where: { key: perm.key }, update: {}, create: perm });
  }
}

let orgCounter = 0;

/** Organisation de test jetable, provisionnée avec les mêmes rôles/listes/templates par défaut qu'en production. */
export async function createTestOrganization(namePrefix = "Test Org") {
  orgCounter += 1;
  const slug = `test-${Date.now()}-${orgCounter}-${Math.random().toString(36).slice(2, 8)}`;
  return prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({ data: { name: `${namePrefix} ${slug}`, slug } });
    await provisionDefaultOrganizationData(tx, org.id);
    return org;
  });
}

export async function createTestUser(organizationId: string, roleName: string = ADMINISTRATOR_ROLE_NAME) {
  const role = await prisma.role.findFirstOrThrow({ where: { organizationId, name: roleName } });
  const password = await bcrypt.hash("Passw0rd!", 4); // coût réduit — tests uniquement
  const user = await prisma.user.create({
    data: {
      organizationId,
      email: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`,
      password,
      roleId: role.id,
    },
  });

  const permissionRows = await prisma.rolePermission.findMany({
    where: { roleId: role.id },
    include: { permission: { select: { key: true } } },
  });

  const authUser: AuthenticatedUser = {
    id: user.id,
    organizationId,
    email: user.email,
    roleId: role.id,
    permissions: permissionRows.map((rp) => rp.permission.key),
  };

  return { user, authUser, db: getScopedClient(organizationId) };
}
