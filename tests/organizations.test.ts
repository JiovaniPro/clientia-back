import { describe, expect, it } from "vitest";
import { prisma } from "../src/db/prisma.js";
import * as organizationsService from "../src/modules/organizations/service.js";
import { createTestOrganization, createTestUser, ensurePermissionsSeeded } from "./helpers.js";

/**
 * Gap trouvé en construisant §5.29 (création côté plateforme) : `createOrganization`
 * définit `ORGANIZATION_CREATED` dans l'enum mais ne l'écrivait jamais — corrigé pour
 * les deux chemins de création (auto-inscription ET plateforme, voir platformOrganizations.test.ts).
 */
describe("création d'organisation — auto-inscription (POST /organizations public)", () => {
  it("provisionne l'organisation et écrit l'audit avec le premier admin comme acteur", async () => {
    const slug = `self-registered-${Date.now()}`;
    const { organization, adminUser } = await organizationsService.createOrganization({
      organizationName: "Auto-inscrite",
      organizationSlug: slug,
      adminEmail: `admin-${slug}@test.local`,
      adminPassword: "Passw0rd!Long",
    });

    expect(organization.name).toBe("Auto-inscrite");

    const auditRow = await prisma.auditLog.findFirst({
      where: { organizationId: organization.id, action: "ORGANIZATION_CREATED" },
    });
    expect(auditRow?.userId).toBe(adminUser.id);
    expect((auditRow?.meta as Record<string, unknown> | null)?.triggeredBy).toBe("self_registration");
  });

  it("refuse un slug déjà utilisé", async () => {
    const org = await createTestOrganization("Org Slug Duplicate");

    await expect(
      organizationsService.createOrganization({
        organizationName: "Doublon",
        organizationSlug: org.slug,
        adminEmail: "autre@test.local",
        adminPassword: "Passw0rd!Long",
      }),
    ).rejects.toThrow("Cet identifiant d'espace de travail est déjà utilisé");
  });
});

/** §5.24 — paramètres d'organisation (GET/PATCH /organizations/me). */
describe("lecture de l'organisation courante", () => {
  it("renvoie l'organisation de l'utilisateur, jamais une autre", async () => {
    await ensurePermissionsSeeded();
    const orgA = await createTestOrganization("Org Settings A");
    const orgB = await createTestOrganization("Org Settings B");
    const adminA = await createTestUser(orgA.id, "Administrateur");

    const result = await organizationsService.getCurrentOrganization(adminA.db, adminA.authUser.organizationId);

    expect(result.id).toBe(orgA.id);
    expect(result.id).not.toBe(orgB.id);
  });
});

describe("modification de l'organisation courante", () => {
  it("met à jour le nom et la couleur principale", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Settings Update");
    const admin = await createTestUser(org.id, "Administrateur");

    const updated = await organizationsService.updateCurrentOrganization(admin.db, admin.authUser, {
      name: "Nouveau nom",
      primaryColor: "#2f6f4f",
    });

    expect(updated.name).toBe("Nouveau nom");
    expect(updated.primaryColor).toBe("#2f6f4f");
    // le slug n'est pas modifiable via ce endpoint — identifiant stable, pas dans le schéma d'entrée
    expect(updated.slug).toBe(org.slug);
  });

  it("définit un logo puis peut l'effacer explicitement (null), sans que l'omettre ne l'efface", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Settings Logo");
    const admin = await createTestUser(org.id, "Administrateur");

    const withLogo = await organizationsService.updateCurrentOrganization(admin.db, admin.authUser, {
      logoUrl: "https://example.com/logo.png",
    });
    expect(withLogo.logoUrl).toBe("https://example.com/logo.png");

    // Omettre le champ ne doit rien changer.
    const unchanged = await organizationsService.updateCurrentOrganization(admin.db, admin.authUser, {
      name: withLogo.name,
    });
    expect(unchanged.logoUrl).toBe("https://example.com/logo.png");

    // Envoyer explicitement null efface le logo.
    const cleared = await organizationsService.updateCurrentOrganization(admin.db, admin.authUser, {
      logoUrl: null,
    });
    expect(cleared.logoUrl).toBeNull();
  });

  it("ne modifie que l'organisation de l'acteur — une autre organisation reste intacte", async () => {
    await ensurePermissionsSeeded();
    const orgA = await createTestOrganization("Org Settings Isolation A");
    const orgB = await createTestOrganization("Org Settings Isolation B");
    const adminA = await createTestUser(orgA.id, "Administrateur");

    // `updateCurrentOrganization` cible toujours `user.organizationId` (jamais un id
    // fourni par l'appelant, voir service.ts) — orgB ne peut donc pas être atteinte.
    await organizationsService.updateCurrentOrganization(adminA.db, adminA.authUser, { name: "Renommée par A" });

    const orgBRow = await adminA.db.organization.findUnique({ where: { id: orgB.id } });
    expect(orgBRow?.name).toBe(orgB.name);
  });
});
