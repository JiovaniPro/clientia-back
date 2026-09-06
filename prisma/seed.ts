/**
 * Seed idempotent — sûr à relancer (`npm run prisma:migrate` ré-exécute ce script,
 * ou directement `tsx prisma/seed.ts`).
 *
 * 1. Catalogue global `Permission` (jamais scopé par organisation).
 * 2. Une organisation de démo + son provisioning par défaut (rôles/listes/templates).
 * 3. Un compte par rôle système, pour tester la connexion tout de suite.
 * 4. Un `PlatformAdmin` de démo pour la console Super Admin.
 */
import bcrypt from "bcryptjs";
import { prisma } from "../src/db/prisma.js";
import { PERMISSIONS_CATALOG } from "../src/lib/permissionsCatalog.js";
import { DEFAULT_ROLES } from "../src/lib/defaultRoles.js";
import { provisionDefaultOrganizationData } from "../src/modules/organizations/defaultData.js";

const DEMO_ORG_SLUG = "demo";
const DEMO_PASSWORD = "Passw0rd!"; // dev uniquement — jamais utilisé en production

async function seedPermissionsCatalog() {
  for (const perm of PERMISSIONS_CATALOG) {
    await prisma.permission.upsert({
      where: { key: perm.key },
      update: { module: perm.module, label: perm.label, description: perm.description ?? null },
      create: perm,
    });
  }
  console.log(`  Permissions : ${PERMISSIONS_CATALOG.length} clés upsertées.`);
}

async function seedDemoOrganization() {
  const existing = await prisma.organization.findUnique({ where: { slug: DEMO_ORG_SLUG } });
  if (existing) {
    console.log(`  Organisation de démo déjà présente (${existing.id}), étape ignorée.`);
    return existing;
  }

  const org = await prisma.$transaction(async (tx) => {
    const created = await tx.organization.create({
      data: {
        name: "Organisation de démo",
        slug: DEMO_ORG_SLUG,
        primaryColor: "#2F5D50",
      },
    });

    await provisionDefaultOrganizationData(tx, created.id);

    return created;
  });

  console.log(`  Organisation de démo créée (${org.id}).`);
  return org;
}

async function seedDemoUsers(organizationId: string) {
  const roles = await prisma.role.findMany({
    where: { organizationId, name: { in: DEFAULT_ROLES.map((r) => r.name) } },
  });
  const roleIdByName = new Map(roles.map((r) => [r.name, r.id]));
  const hashedPassword = await bcrypt.hash(DEMO_PASSWORD, 10);

  const demoUsers = [
    { roleName: "Administrateur", email: "admin@demo.clientia.app", firstName: "Alix", lastName: "Admin" },
    { roleName: "Agent calliste", email: "calliste@demo.clientia.app", firstName: "Camille", lastName: "Calliste" },
    { roleName: "Agent RDV", email: "agent-rdv@demo.clientia.app", firstName: "Robin", lastName: "RDV" },
  ];

  for (const demoUser of demoUsers) {
    const roleId = roleIdByName.get(demoUser.roleName);
    if (!roleId) {
      console.warn(`  Rôle "${demoUser.roleName}" introuvable, utilisateur de démo ignoré.`);
      continue;
    }

    await prisma.user.upsert({
      where: { organizationId_email: { organizationId, email: demoUser.email } },
      update: {},
      create: {
        organizationId,
        email: demoUser.email,
        password: hashedPassword,
        firstName: demoUser.firstName,
        lastName: demoUser.lastName,
        roleId,
      },
    });
  }

  console.log(`  ${demoUsers.length} utilisateurs de démo prêts (mot de passe : ${DEMO_PASSWORD}).`);
}

async function seedPlatformAdmin() {
  const email = "superadmin@clientia.app";
  const existing = await prisma.platformAdmin.findUnique({ where: { email } });
  if (existing) {
    console.log("  Super Admin de démo déjà présent, étape ignorée.");
    return;
  }

  const hashedPassword = await bcrypt.hash(DEMO_PASSWORD, 10);
  await prisma.platformAdmin.create({
    data: { email, password: hashedPassword, name: "Super Admin" },
  });
  console.log(`  Super Admin de démo créé (${email} / ${DEMO_PASSWORD}).`);
}

async function main() {
  console.log("Seed CLIENTIA — démarrage");

  console.log("1. Catalogue de permissions");
  await seedPermissionsCatalog();

  console.log("2. Organisation de démo (rôles, listes configurables, modèles d'e-mail)");
  const org = await seedDemoOrganization();

  console.log("3. Utilisateurs de démo");
  await seedDemoUsers(org.id);

  console.log("4. Super Admin de démo");
  await seedPlatformAdmin();

  console.log("Seed terminé.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
