import { describe, expect, it } from "vitest";
import { prisma } from "../src/db/prisma.js";
import { HttpError } from "../src/lib/httpError.js";
import * as rolesService from "./../src/modules/roles/service.js";
import { createTestOrganization, createTestUser, ensurePermissionsSeeded } from "./helpers.js";

describe("catalogue des permissions", () => {
  it("liste le catalogue global, regroupé par module", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Roles Catalog");
    const admin = await createTestUser(org.id, "Administrateur");

    const catalog = await rolesService.listPermissionsCatalog(admin.db);
    expect(catalog.length).toBeGreaterThan(10);
    expect(catalog.some((p) => p.key === "users.deactivate")).toBe(true);
    // Le catalogue est global (jamais scopé par organisation) — même contenu partout.
    const org2 = await createTestOrganization("Org Roles Catalog 2");
    const admin2 = await createTestUser(org2.id, "Administrateur");
    const catalog2 = await rolesService.listPermissionsCatalog(admin2.db);
    expect(catalog2.length).toBe(catalog.length);
  });
});

describe("liste des rôles", () => {
  it("liste les 3 rôles système provisionnés par défaut, avec permissions et nombre d'utilisateurs", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Roles List");
    const admin = await createTestUser(org.id, "Administrateur");

    const roles = await rolesService.listRoles(admin.db);
    expect(roles).toHaveLength(3);
    expect(roles.every((r) => r.isSystem)).toBe(true);
    const adminRole = roles.find((r) => r.name === "Administrateur")!;
    expect(adminRole.permissions.length).toBeGreaterThan(0);
    expect(adminRole._count.users).toBe(1); // le compte admin créé par createTestUser
  });

  it("n'expose jamais les rôles d'une autre organisation", async () => {
    await ensurePermissionsSeeded();
    const orgA = await createTestOrganization("Org Roles Isolation A");
    const orgB = await createTestOrganization("Org Roles Isolation B");
    const adminA = await createTestUser(orgA.id, "Administrateur");

    await rolesService.createRole(adminA.db, adminA.authUser, {
      name: "Rôle Spécifique A",
      permissionKeys: [],
    });

    const adminB = await createTestUser(orgB.id, "Administrateur");
    const rolesB = await rolesService.listRoles(adminB.db);
    expect(rolesB.some((r) => r.name === "Rôle Spécifique A")).toBe(false);
  });
});

describe("création de rôle", () => {
  it("crée un rôle personnalisé avec un sous-ensemble de permissions", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Roles Create");
    const admin = await createTestUser(org.id, "Administrateur");

    const role = await rolesService.createRole(admin.db, admin.authUser, {
      name: "Superviseur",
      description: "Supervise les agents calliste",
      color: "#2f6f4f",
      permissionKeys: ["calls.view", "calls.viewAll", "reports.view"],
    });

    expect(role.isSystem).toBe(false);
    expect(role.permissions.map((p) => p.permission.key).sort()).toEqual(
      ["calls.view", "calls.viewAll", "reports.view"].sort(),
    );
  });

  it("refuse un nom de rôle déjà utilisé dans l'organisation", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Roles Duplicate");
    const admin = await createTestUser(org.id, "Administrateur");

    await expect(
      rolesService.createRole(admin.db, admin.authUser, { name: "Administrateur", permissionKeys: [] }),
    ).rejects.toThrow(HttpError);
  });

  it("refuse une clé de permission inconnue", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Roles Bad Permission");
    const admin = await createTestUser(org.id, "Administrateur");

    await expect(
      rolesService.createRole(admin.db, admin.authUser, {
        name: "Rôle Invalide",
        permissionKeys: ["permission.inexistante"],
      }),
    ).rejects.toThrow(HttpError);
  });
});

describe("modification de rôle", () => {
  it("remplace entièrement l'ensemble de permissions", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Roles Update Permissions");
    const admin = await createTestUser(org.id, "Administrateur");
    const role = await rolesService.createRole(admin.db, admin.authUser, {
      name: "Rôle À Modifier",
      permissionKeys: ["calls.view"],
    });

    const updated = await rolesService.updateRole(admin.db, admin.authUser, role.id, {
      permissionKeys: ["clients.view", "clients.update"],
    });

    expect(updated.permissions.map((p) => p.permission.key).sort()).toEqual(["clients.update", "clients.view"]);
  });

  it("un rôle système reste éditable (nom, description, permissions) — seule la suppression est bloquée", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Roles Update System");
    const admin = await createTestUser(org.id, "Administrateur");
    const roles = await rolesService.listRoles(admin.db);
    const agentRdv = roles.find((r) => r.name === "Agent RDV")!;

    const updated = await rolesService.updateRole(admin.db, admin.authUser, agentRdv.id, {
      description: "Description mise à jour",
    });

    expect(updated.description).toBe("Description mise à jour");
    expect(updated.isSystem).toBe(true);
  });

  it("refuse un id de rôle inexistant", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Roles Update Missing");
    const admin = await createTestUser(org.id, "Administrateur");

    await expect(
      rolesService.updateRole(admin.db, admin.authUser, "role-inexistant", { name: "X" }),
    ).rejects.toThrow(HttpError);
  });
});

describe("suppression de rôle — garde-fous", () => {
  it("refuse de supprimer un rôle système", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Roles Delete System");
    const admin = await createTestUser(org.id, "Administrateur");
    const roles = await rolesService.listRoles(admin.db);
    const agentCalliste = roles.find((r) => r.name === "Agent calliste")!;

    await expect(rolesService.deleteRole(admin.db, admin.authUser, agentCalliste.id)).rejects.toThrow(
      "Les rôles système ne peuvent pas être supprimés",
    );
  });

  it("refuse de supprimer un rôle encore assigné à au moins un utilisateur", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Roles Delete Assigned");
    const admin = await createTestUser(org.id, "Administrateur");
    const role = await rolesService.createRole(admin.db, admin.authUser, {
      name: "Rôle Assigné",
      permissionKeys: [],
    });
    await createTestUser(org.id, "Administrateur"); // peuple l'org, sans lien avec le rôle testé
    const roleUser = await prisma.user.create({
      data: {
        organizationId: org.id,
        email: `assigne-${Date.now()}@test.local`,
        password: "hash-non-pertinent-pour-ce-test",
        roleId: role.id,
      },
    });

    await expect(rolesService.deleteRole(admin.db, admin.authUser, role.id)).rejects.toThrow(
      "Ce rôle est encore assigné à des utilisateurs",
    );

    // nettoyage — évite de polluer les compteurs d'un autre test si la DB de test est partagée
    await prisma.user.delete({ where: { id: roleUser.id } });
  });

  it("supprime un rôle personnalisé non assigné", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Roles Delete Ok");
    const admin = await createTestUser(org.id, "Administrateur");
    const role = await rolesService.createRole(admin.db, admin.authUser, {
      name: "Rôle Jetable",
      permissionKeys: [],
    });

    await rolesService.deleteRole(admin.db, admin.authUser, role.id);

    const stillThere = await prisma.role.findUnique({ where: { id: role.id } });
    expect(stillThere).toBeNull();
  });
});
