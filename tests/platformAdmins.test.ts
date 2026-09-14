import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import * as platformAdminsService from "../src/modules/platform/admins/service.js";

const app = createApp();

async function createLiveAdmin(prefix: string) {
  const email = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
  const admin = await platformAdminsService.createAdmin({ email, password: "InitialPassw0rd!", name: "Test" });
  return { admin, email };
}

describe("§5.29 sous-lot 3 — gestion des Super Admins", () => {
  it("crée un compte avec mustChangePassword=true et sans exposer le hash", async () => {
    const { admin } = await createLiveAdmin("create");

    expect(admin.mustChangePassword).toBe(true);
    expect(admin).not.toHaveProperty("password");
  });

  it("refuse un e-mail déjà utilisé", async () => {
    const { email } = await createLiveAdmin("dupe");

    await expect(
      platformAdminsService.createAdmin({ email, password: "AutrePassw0rd!" }),
    ).rejects.toThrow("Un compte Super Admin utilise déjà cet e-mail");
  });

  it("liste les comptes sans exposer les hashs de mot de passe", async () => {
    await createLiveAdmin("list");
    const admins = await platformAdminsService.listAdmins();

    expect(admins.length).toBeGreaterThan(0);
    expect(admins.every((a) => !("password" in a))).toBe(true);
  });

  it("met à jour le nom et l'e-mail", async () => {
    const { admin } = await createLiveAdmin("update");

    const updated = await platformAdminsService.updateAdmin(admin.id, { name: "Nom modifié" });

    expect(updated.name).toBe("Nom modifié");
  });

  describe("garde-fous — activer / désactiver", () => {
    it("un Super Admin ne peut jamais se désactiver lui-même", async () => {
      const { admin } = await createLiveAdmin("self-deactivate");
      await createLiveAdmin("self-deactivate-bystander"); // un second admin actif — élimine la piste "dernier admin"

      await expect(
        platformAdminsService.setAdminStatus(admin.id, { isActive: false }, admin),
      ).rejects.toThrow("Vous ne pouvez pas désactiver votre propre compte");
    });

    it("le dernier Super Admin actif ne peut jamais être désactivé", async () => {
      const { admin: soleAdmin } = await createLiveAdmin("sole");
      // `PlatformAdmin` est un domaine global, sans isolation par organisation —
      // contrairement aux tests /users, on ne peut pas compter sur une organisation
      // de test fraîche pour garantir "un seul admin actif" : on désactive
      // explicitement tous les autres comptes (y compris ceux laissés par d'autres
      // tests de ce fichier) pour rendre la précondition déterministe.
      await prisma.platformAdmin.updateMany({ where: { id: { not: soleAdmin.id } }, data: { isActive: false } });
      // Acteur distinct du compte cible — pas de piste "auto-désactivation" ici,
      // seulement "aucun gestionnaire ne resterait actif".
      const bystanderActor = { id: "acteur-tiers-inexistant", email: "tiers@test.local" };

      await expect(
        platformAdminsService.setAdminStatus(soleAdmin.id, { isActive: false }, bystanderActor),
      ).rejects.toThrow("Impossible de désactiver le dernier Super Admin actif");

      const stillActive = await prisma.platformAdmin.findUniqueOrThrow({ where: { id: soleAdmin.id } });
      expect(stillActive.isActive).toBe(true);
    });

    it("désactiver le premier admin devient possible dès qu'un second existe, révoque ses sessions", async () => {
      const { admin: adminA } = await createLiveAdmin("two-a");
      const { admin: adminB } = await createLiveAdmin("two-b");
      // Même précondition déterministe que le test précédent — seuls A et B actifs.
      await prisma.platformAdmin.updateMany({
        where: { id: { notIn: [adminA.id, adminB.id] } },
        data: { isActive: false },
      });

      const session = await prisma.platformSession.create({
        data: {
          platformAdminId: adminA.id,
          refreshToken: `fake-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
        },
      });

      const result = await platformAdminsService.setAdminStatus(adminA.id, { isActive: false }, adminB);
      expect(result.isActive).toBe(false);

      const sessionAfter = await prisma.platformSession.findUniqueOrThrow({ where: { id: session.id } });
      expect(sessionAfter.revokedAt).not.toBeNull();

      // adminB reste seul actif — le désactiver à son tour doit maintenant échouer.
      await expect(
        platformAdminsService.setAdminStatus(adminB.id, { isActive: false }, adminA),
      ).rejects.toThrow("Impossible de désactiver le dernier Super Admin actif");
    });

    it("réactiver ne déclenche aucun des deux garde-fous", async () => {
      const { admin: adminA } = await createLiveAdmin("reactivate-a");
      const { admin: adminB } = await createLiveAdmin("reactivate-b");
      await platformAdminsService.setAdminStatus(adminA.id, { isActive: false }, adminB);

      const reactivated = await platformAdminsService.setAdminStatus(adminA.id, { isActive: true }, adminB);
      expect(reactivated.isActive).toBe(true);
    });

    it("jamais de suppression physique — désactiver laisse la ligne intacte", async () => {
      const { admin: adminA } = await createLiveAdmin("no-delete-a");
      const { admin: adminB } = await createLiveAdmin("no-delete-b");
      await platformAdminsService.setAdminStatus(adminA.id, { isActive: false }, adminB);

      const stillThere = await prisma.platformAdmin.findUnique({ where: { id: adminA.id } });
      expect(stillThere).not.toBeNull();
      expect(stillThere?.isActive).toBe(false);
    });
  });

  describe("changement de mot de passe obligatoire (POST /platform/auth/change-password)", () => {
    it("connexion signale mustChangePassword=true, le changement le lève, révoque les autres sessions", async () => {
      const email = `change-pwd-${Date.now()}@test.local`;
      await platformAdminsService.createAdmin({ email, password: "InitialPassw0rd!" });

      const loginRes = await request(app).post("/platform/auth/login").send({ email, password: "InitialPassw0rd!" });
      expect(loginRes.status).toBe(200);
      expect(loginRes.body.platformAdmin.mustChangePassword).toBe(true);

      const wrongCurrentRes = await request(app)
        .post("/platform/auth/change-password")
        .set("Authorization", `Bearer ${loginRes.body.accessToken}`)
        .send({ currentPassword: "MauvaisMotDePasse", newPassword: "NouveauPassw0rd!" });
      expect(wrongCurrentRes.status).toBe(401);

      const changeRes = await request(app)
        .post("/platform/auth/change-password")
        .set("Authorization", `Bearer ${loginRes.body.accessToken}`)
        .send({ currentPassword: "InitialPassw0rd!", newPassword: "NouveauPassw0rd!" });
      expect(changeRes.status).toBe(204);

      const meRes = await request(app)
        .get("/platform/auth/me")
        .set("Authorization", `Bearer ${loginRes.body.accessToken}`);
      expect(meRes.body.platformAdmin.mustChangePassword).toBe(false);

      // Le nouveau mot de passe fonctionne, l'ancien ne fonctionne plus.
      const reloginOldRes = await request(app).post("/platform/auth/login").send({ email, password: "InitialPassw0rd!" });
      expect(reloginOldRes.status).toBe(401);
      const reloginNewRes = await request(app).post("/platform/auth/login").send({ email, password: "NouveauPassw0rd!" });
      expect(reloginNewRes.status).toBe(200);
    });
  });
});
