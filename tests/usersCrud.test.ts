import { describe, expect, it } from "vitest";
import { prisma } from "../src/db/prisma.js";
import { HttpError } from "../src/lib/httpError.js";
import * as authService from "../src/modules/auth/service.js";
import * as usersService from "../src/modules/users/service.js";
import { createTestOrganization, createTestUser, ensurePermissionsSeeded } from "./helpers.js";

async function getLatestResetLink(userId: string): Promise<string> {
  const row = await prisma.emailQueue.findFirst({
    where: { recipientUserId: userId },
    orderBy: { createdAt: "desc" },
  });
  const match = row?.directBody?.match(/href="([^"]+)"/);
  if (!match) throw new Error("Aucun lien de réinitialisation trouvé dans la file d'e-mails");
  const url = new URL(match[1]!);
  const token = url.searchParams.get("token");
  if (!token) throw new Error("Jeton absent du lien");
  return token;
}

describe("création d'utilisateur", () => {
  it("crée un compte sans mot de passe connu et envoie un lien de définition", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Users Create");
    const admin = await createTestUser(org.id, "Administrateur");
    const role = await prisma.role.findFirstOrThrow({ where: { organizationId: org.id, name: "Agent RDV" } });

    const created = await usersService.createUser(admin.db, admin.authUser, {
      email: "nouveau.agent@test.local",
      firstName: "Nouveau",
      lastName: "Agent",
      roleId: role.id,
    });

    expect(created).not.toHaveProperty("password");
    expect(created.isActive).toBe(true);

    const raw = await prisma.user.findUniqueOrThrow({ where: { id: created.id } });
    // Le hash ne correspond à AUCUN mot de passe connaissable — même l'admin qui a créé
    // le compte ne peut pas se connecter avec quoi que ce soit qu'il aurait choisi.
    expect(raw.password).not.toBe("");

    const token = await getLatestResetLink(created.id);
    expect(token).toHaveLength(64); // 32 octets en hexadécimal
  });

  it("refuse un e-mail déjà utilisé dans l'organisation", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Users Duplicate Email");
    const admin = await createTestUser(org.id, "Administrateur");
    const role = await prisma.role.findFirstOrThrow({ where: { organizationId: org.id, name: "Agent RDV" } });

    await usersService.createUser(admin.db, admin.authUser, { email: "dupe@test.local", roleId: role.id });
    await expect(
      usersService.createUser(admin.db, admin.authUser, { email: "dupe@test.local", roleId: role.id }),
    ).rejects.toThrow(HttpError);
  });

  it("refuse un roleId qui n'existe pas dans l'organisation", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Users Bad Role");
    const admin = await createTestUser(org.id, "Administrateur");

    await expect(
      usersService.createUser(admin.db, admin.authUser, { email: "x@test.local", roleId: "role-inexistant" }),
    ).rejects.toThrow(HttpError);
  });
});

describe("modification d'utilisateur", () => {
  it("met à jour le profil et le rôle", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Users Update");
    const admin = await createTestUser(org.id, "Administrateur");
    const roleAgentRdv = await prisma.role.findFirstOrThrow({ where: { organizationId: org.id, name: "Agent RDV" } });
    const roleCalliste = await prisma.role.findFirstOrThrow({ where: { organizationId: org.id, name: "Agent calliste" } });

    const created = await usersService.createUser(admin.db, admin.authUser, {
      email: "modif@test.local",
      roleId: roleAgentRdv.id,
    });
    const updated = await usersService.updateUser(admin.db, admin.authUser, created.id, {
      firstName: "Robin",
      lastName: "RDV",
      roleId: roleCalliste.id,
    });

    expect(updated.firstName).toBe("Robin");
    expect(updated.roleId).toBe(roleCalliste.id);
  });
});

describe("activation / désactivation — garde-fous impératifs", () => {
  it("un admin ne peut jamais se désactiver lui-même, même s'il n'est pas le dernier", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Users Self Deactivate");
    const adminA = await createTestUser(org.id, "Administrateur");
    await createTestUser(org.id, "Administrateur"); // un second admin actif — élimine la piste "dernier admin"

    await expect(
      usersService.setUserStatus(adminA.db, adminA.authUser, adminA.user.id, { isActive: false }),
    ).rejects.toThrow("Vous ne pouvez pas désactiver votre propre compte");

    const stillActive = await prisma.user.findUniqueOrThrow({ where: { id: adminA.user.id } });
    expect(stillActive.isActive).toBe(true);
  });

  /**
   * Isolation trouvée en vérifiant en direct (pas en écrivant le test) : passer
   * `soleAdmin.authUser` comme acteur ET comme cible aurait fait échouer ce test
   * pour la MAUVAISE raison (garde-fou 1, auto-désactivation) sans jamais exercer
   * le garde-fou 2. Corrigé en utilisant un acteur RÉELLEMENT distinct
   * (`bystander.authUser`) — mais ce scénario n'est de toute façon accessible
   * QU'au niveau service : `bystander` (rôle Agent RDV) n'a pas `users.deactivate`,
   * donc la vraie route HTTP le rejetterait en 403 avant même d'atteindre ce
   * garde-fou (`requirePermission("users.deactivate")`). Constat honnête : à
   * travers la route réelle authentifiée, le garde-fou 2 ne peut jamais se
   * déclencher indépendamment du garde-fou 1 — seul le dernier gestionnaire actif
   * peut atteindre cette route pour cibler quiconque, et s'il se cible lui-même
   * (le seul cas réel possible une fois qu'il ne reste que lui), le garde-fou 1
   * bloque déjà. Le garde-fou 2 reste une défense en profondeur légitime au niveau
   * service (utile si le garde-fou 1 était un jour retiré par erreur, ou si un
   * futur appelant interne n'y passe pas), vérifiée ici indépendamment, mais pas
   * démontrable comme un 409 distinct via une vraie requête HTTP.
   */
  it("le dernier utilisateur actif pouvant gérer les comptes ne peut jamais être désactivé (vérifié au niveau service)", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Users Last Admin");
    const soleAdmin = await createTestUser(org.id, "Administrateur");
    const bystander = await createTestUser(org.id, "Agent RDV"); // n'a pas users.deactivate

    await expect(
      usersService.setUserStatus(bystander.db, bystander.authUser, soleAdmin.user.id, { isActive: false }),
    ).rejects.toThrow("Impossible de désactiver le dernier utilisateur actif pouvant gérer les comptes");

    const stillActive = await prisma.user.findUniqueOrThrow({ where: { id: soleAdmin.user.id } });
    expect(stillActive.isActive).toBe(true);
  });

  it("désactiver le premier admin devient possible dès qu'un second existe", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Users Second Admin");
    const adminA = await createTestUser(org.id, "Administrateur");
    const adminB = await createTestUser(org.id, "Administrateur");

    const result = await usersService.setUserStatus(adminB.db, adminB.authUser, adminA.user.id, { isActive: false });
    expect(result.isActive).toBe(false);

    // adminB reste seul actif capable de gérer les comptes — le désactiver à son tour
    // doit maintenant échouer (adminA est désactivé, ne compte plus — même si on lui
    // prête artificiellement le rôle d'acteur ici, ce qu'un utilisateur désactivé ne
    // pourrait jamais faire en réalité puisqu'il ne peut plus s'authentifier).
    await expect(
      usersService.setUserStatus(adminB.db, adminA.authUser, adminB.user.id, { isActive: false }),
    ).rejects.toThrow("Impossible de désactiver le dernier utilisateur actif pouvant gérer les comptes");
  });

  it("réactiver ne déclenche aucun des deux garde-fous", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Users Reactivate");
    const adminA = await createTestUser(org.id, "Administrateur");
    const adminB = await createTestUser(org.id, "Administrateur");
    await usersService.setUserStatus(adminB.db, adminB.authUser, adminA.user.id, { isActive: false });

    // adminB réactive adminA — sur soi-même ce serait un no-op sans risque, ici sur un tiers désactivé.
    const reactivated = await usersService.setUserStatus(adminB.db, adminB.authUser, adminA.user.id, { isActive: true });
    expect(reactivated.isActive).toBe(true);
  });

  it("jamais de suppression physique — désactiver laisse la ligne intacte", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Users No Delete");
    const adminA = await createTestUser(org.id, "Administrateur");
    const adminB = await createTestUser(org.id, "Administrateur");
    await usersService.setUserStatus(adminB.db, adminB.authUser, adminA.user.id, { isActive: false });

    const stillThere = await prisma.user.findUnique({ where: { id: adminA.user.id } });
    expect(stillThere).not.toBeNull();
    expect(stillThere?.isActive).toBe(false);
  });
});

describe("réinitialisation de mot de passe par lien", () => {
  it("un admin déclenche l'envoi, l'utilisateur cible définit son mot de passe via le lien", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Users Reset Flow");
    const admin = await createTestUser(org.id, "Administrateur");
    const target = await createTestUser(org.id, "Agent RDV");

    await usersService.requestPasswordReset(admin.db, admin.authUser, target.user.id);
    const token = await getLatestResetLink(target.user.id);

    await authService.confirmPasswordReset({ token, newPassword: "NouveauMotDePasse123" });

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: target.user.id } });
    expect(updated.password).not.toBe(target.user.password);
  });

  it("un jeton est à usage unique", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Users Reset Single Use");
    const admin = await createTestUser(org.id, "Administrateur");
    const target = await createTestUser(org.id, "Agent RDV");

    await usersService.requestPasswordReset(admin.db, admin.authUser, target.user.id);
    const token = await getLatestResetLink(target.user.id);

    await authService.confirmPasswordReset({ token, newPassword: "PremierMotDePasse1" });
    await expect(
      authService.confirmPasswordReset({ token, newPassword: "SecondMotDePasse2" }),
    ).rejects.toThrow(HttpError);
  });

  it("un jeton invalide/inexistant est rejeté", async () => {
    await ensurePermissionsSeeded();
    await expect(
      authService.confirmPasswordReset({ token: "jeton-invente-jamais-emis", newPassword: "PeuImporte123" }),
    ).rejects.toThrow(HttpError);
  });

  it("émettre un nouveau lien invalide le précédent (un seul lien valide à la fois)", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Users Reset Supersede");
    const admin = await createTestUser(org.id, "Administrateur");
    const target = await createTestUser(org.id, "Agent RDV");

    await usersService.requestPasswordReset(admin.db, admin.authUser, target.user.id);
    const firstToken = await getLatestResetLink(target.user.id);

    await usersService.requestPasswordReset(admin.db, admin.authUser, target.user.id);
    const secondToken = await getLatestResetLink(target.user.id);

    expect(firstToken).not.toBe(secondToken);
    await expect(
      authService.confirmPasswordReset({ token: firstToken, newPassword: "TenteAvecAncien1" }),
    ).rejects.toThrow(HttpError);

    // Le second lien, lui, fonctionne toujours.
    await authService.confirmPasswordReset({ token: secondToken, newPassword: "AvecLeNouveau123" });
  });

  it("la création d'un compte envoie aussi un lien, réutilisable pour définir le mot de passe initial", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Users Reset On Create");
    const admin = await createTestUser(org.id, "Administrateur");
    const role = await prisma.role.findFirstOrThrow({ where: { organizationId: org.id, name: "Agent RDV" } });

    const created = await usersService.createUser(admin.db, admin.authUser, {
      email: "premiere.connexion@test.local",
      roleId: role.id,
    });
    const token = await getLatestResetLink(created.id);
    await authService.confirmPasswordReset({ token, newPassword: "MonPremierMotDePasse1" });

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: created.id } });
    const bcrypt = await import("bcryptjs");
    expect(await bcrypt.default.compare("MonPremierMotDePasse1", updated.password)).toBe(true);
  });
});
