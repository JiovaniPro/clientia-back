import { describe, expect, it } from "vitest";
import * as clientsService from "../src/modules/clients/service.js";
import * as emailsService from "../src/modules/emails/service.js";
import { createTestOrganization, createTestUser, ensurePermissionsSeeded } from "./helpers.js";

/**
 * §5.12 sous-lot 1 — suppression physique d'un modèle d'e-mail, avec garde-fou.
 * Même principe que tests/configurableListItemDelete.test.ts : le garde-fou vient
 * nativement de la contrainte de clé étrangère Postgres (EmailHistory.emailTemplateId
 * est une FK requise, sans `onDelete` déclaré) — pas de comptage applicatif à récrire.
 */
async function createTestClientWithEmail(
  user: Awaited<ReturnType<typeof createTestUser>>,
  organizationId: string,
  phoneSuffix: string,
) {
  const status = await user.db.configurableListItem.findFirstOrThrow({
    where: { listKey: "CALL_STATUS", isDefault: true },
  });
  const country = await user.db.configurableListItem.findFirstOrThrow({
    where: { listKey: "CLIENT_COUNTRY", isDefault: true },
  });
  const call = await user.db.call.create({
    data: {
      organizationId,
      userId: user.user.id,
      direction: "OUTBOUND",
      type: "PROSPECTION",
      statusId: status.id,
      fromNumber: "+33000000000",
      toNumber: `+3300000${phoneSuffix}`,
      occurredAt: new Date(),
    },
  });
  return clientsService.createClient(user.db, user.authUser, {
    callId: call.id,
    agentId: user.user.id,
    phoneNumber: `+3300000${phoneSuffix}`,
    email: "client@example.com",
    countryKey: country.key,
  });
}

describe("suppression d'un modèle d'e-mail — garde-fou par contrainte DB", () => {
  it("refuse la suppression d'un modèle déjà référencé par un envoi (EmailHistory.emailTemplateId)", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Emails Delete Guard");
    const admin = await createTestUser(org.id, "Administrateur");

    const template = await emailsService.createTemplate(admin.db, admin.authUser, {
      key: "modele_deja_envoye",
      label: "Modèle déjà envoyé",
      subject: "Bonjour {{prenom_client}}",
      body: "Contenu",
    });
    const client = await createTestClientWithEmail(admin, org.id, "001");
    await emailsService.sendManualEmail(admin.db, admin.authUser, {
      clientId: client.id,
      templateKey: template.key,
    });

    await expect(emailsService.deleteTemplate(admin.db, admin.authUser, template.id)).rejects.toThrow(
      "Ce modèle a déjà été utilisé pour un envoi et ne peut pas être supprimé — désactivez-le à la place.",
    );

    const stillThere = await admin.db.emailTemplate.findUnique({ where: { id: template.id } });
    expect(stillThere).not.toBeNull();
  });

  it("supprime un modèle jamais utilisé", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Emails Delete Ok");
    const admin = await createTestUser(org.id, "Administrateur");

    const template = await emailsService.createTemplate(admin.db, admin.authUser, {
      key: "modele_jamais_envoye",
      label: "Modèle jamais envoyé",
      subject: "Sujet",
      body: "Contenu",
    });

    await emailsService.deleteTemplate(admin.db, admin.authUser, template.id);

    const stillThere = await admin.db.emailTemplate.findUnique({ where: { id: template.id } });
    expect(stillThere).toBeNull();
  });

  it("refuse un id inexistant", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Emails Delete Missing");
    const admin = await createTestUser(org.id, "Administrateur");

    await expect(emailsService.deleteTemplate(admin.db, admin.authUser, "template-inexistant")).rejects.toThrow(
      "Modèle introuvable",
    );
  });
});
