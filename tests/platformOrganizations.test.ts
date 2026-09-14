import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import * as authService from "../src/modules/auth/service.js";
import { prisma } from "../src/db/prisma.js";
import { signAccessToken } from "../src/lib/jwt.js";
import * as platformOrganizationsService from "../src/modules/platform/organizations/service.js";
import { createTestOrganization, createTestUser, ensurePermissionsSeeded } from "./helpers.js";

const PLATFORM_ADMIN = { id: "test-platform-admin-id", email: "super-admin-test@clientia.app" };
const app = createApp();

describe("§5.29 sous-lot 2 — organisations côté plateforme", () => {
  it("liste toutes les organisations avec leur nombre d'utilisateurs", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Platform List");
    await createTestUser(org.id, "Administrateur");
    await createTestUser(org.id, "Agent RDV");

    const list = await platformOrganizationsService.listOrganizations();
    const found = list.find((o) => o.id === org.id);

    expect(found).toBeDefined();
    expect(found?._count.users).toBe(2);
  });

  it("le détail d'une organisation liste ses utilisateurs", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Platform Detail");
    const admin = await createTestUser(org.id, "Administrateur");

    const detail = await platformOrganizationsService.getOrganization(org.id);

    expect(detail.users.some((u) => u.id === admin.user.id)).toBe(true);
  });

  it("refuse le détail d'une organisation inexistante", async () => {
    await expect(platformOrganizationsService.getOrganization("org-inexistante")).rejects.toThrow(
      "Organisation introuvable",
    );
  });

  it("crée une organisation, provisionnée comme une auto-inscription, avec l'audit attribué au Super Admin", async () => {
    const slug = `platform-created-${Date.now()}`;
    const detail = await platformOrganizationsService.createOrganization(
      {
        organizationName: "Créée par la plateforme",
        organizationSlug: slug,
        adminEmail: `admin-${slug}@test.local`,
        adminPassword: "Passw0rd!Long",
      },
      PLATFORM_ADMIN,
    );

    expect(detail.name).toBe("Créée par la plateforme");
    expect(detail.users).toHaveLength(1);

    const auditRow = await prisma.auditLog.findFirst({
      where: { organizationId: detail.id, action: "ORGANIZATION_CREATED" },
    });
    expect(auditRow?.userId).toBeNull(); // pas de User-acteur — c'est un Super Admin
    expect((auditRow?.meta as Record<string, unknown> | null)?.platformAdminId).toBe(PLATFORM_ADMIN.id);
  });

  describe("suspendre / réactiver", () => {
    it("suspend une organisation, révoque immédiatement ses sessions actives, et bloque l'accès API dès la requête suivante", async () => {
      await ensurePermissionsSeeded();
      const org = await createTestOrganization("Org Platform Suspend");
      const admin = await createTestUser(org.id, "Administrateur");

      // Simule une session active réelle (comme le ferait un vrai login).
      const session = await prisma.session.create({
        data: {
          userId: admin.user.id,
          refreshToken: `fake-refresh-token-suspend-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
        },
      });

      const suspended = await platformOrganizationsService.setOrganizationStatus(
        org.id,
        { isActive: false },
        PLATFORM_ADMIN,
      );
      expect(suspended.isActive).toBe(false);

      // Révocation immédiate — pas seulement au prochain login.
      const sessionAfter = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
      expect(sessionAfter.revokedAt).not.toBeNull();

      // Toute donnée reste intacte — juste le drapeau.
      const userStillThere = await prisma.user.findUnique({ where: { id: admin.user.id } });
      expect(userStillThere).not.toBeNull();
      expect(userStillThere?.isActive).toBe(true);

      // Une tentative de login échoue désormais.
      await expect(
        authService.login(
          { organizationSlug: org.slug, email: admin.user.email, password: "Passw0rd!" },
          { userAgent: undefined, ipAddress: undefined },
        ),
      ).rejects.toThrow("Identifiants invalides");

      const auditRow = await prisma.auditLog.findFirst({
        where: { organizationId: org.id, action: "ORGANIZATION_DEACTIVATED" },
      });
      expect(auditRow?.userId).toBeNull();
    });

    it("refuse un rafraîchissement de token pour une organisation suspendue (correctif refresh())", async () => {
      await ensurePermissionsSeeded();
      const org = await createTestOrganization("Org Platform Suspend Refresh");
      const admin = await createTestUser(org.id, "Administrateur");

      const { refreshToken } = await authService.login(
        { organizationSlug: org.slug, email: admin.user.email, password: "Passw0rd!" },
        { userAgent: undefined, ipAddress: undefined },
      );

      await platformOrganizationsService.setOrganizationStatus(org.id, { isActive: false }, PLATFORM_ADMIN);

      await expect(
        authService.refresh(refreshToken, { userAgent: undefined, ipAddress: undefined }),
      ).rejects.toThrow("Session invalide ou expirée");
    });

    it("réactiver restaure l'accès sans reconstruire aucune donnée", async () => {
      await ensurePermissionsSeeded();
      const org = await createTestOrganization("Org Platform Reactivate");
      const admin = await createTestUser(org.id, "Administrateur");

      await platformOrganizationsService.setOrganizationStatus(org.id, { isActive: false }, PLATFORM_ADMIN);
      const reactivated = await platformOrganizationsService.setOrganizationStatus(
        org.id,
        { isActive: true },
        PLATFORM_ADMIN,
      );
      expect(reactivated.isActive).toBe(true);

      const loginResult = await authService.login(
        { organizationSlug: org.slug, email: admin.user.email, password: "Passw0rd!" },
        { userAgent: undefined, ipAddress: undefined },
      );
      expect(loginResult.accessToken).toBeTruthy();

      const auditRow = await prisma.auditLog.findFirst({
        where: { organizationId: org.id, action: "ORGANIZATION_ACTIVATED" },
      });
      expect(auditRow).not.toBeNull();
    });

    it("un access token encore valide (non expiré) reçoit le message explicite de suspension, pas un 401 générique", async () => {
      await ensurePermissionsSeeded();
      const org = await createTestOrganization("Org Platform Suspend Message");
      const admin = await createTestUser(org.id, "Administrateur");
      // Access token signé directement — toujours valide 15 min, comme celui qu'un
      // utilisateur en session aurait déjà en main au moment de la suspension.
      const stillValidAccessToken = signAccessToken(admin.user.id);

      await platformOrganizationsService.setOrganizationStatus(org.id, { isActive: false }, PLATFORM_ADMIN);

      const res = await request(app).get("/auth/me").set("Authorization", `Bearer ${stillValidAccessToken}`);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Votre organisation a été suspendue. Contactez votre administrateur.");
    });

    it("refuse de suspendre une organisation inexistante", async () => {
      await expect(
        platformOrganizationsService.setOrganizationStatus("org-inexistante", { isActive: false }, PLATFORM_ADMIN),
      ).rejects.toThrow("Organisation introuvable");
    });
  });
});
