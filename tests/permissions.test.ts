import { beforeAll, describe, expect, it } from "vitest";
import { ADMINISTRATOR_ROLE_NAME } from "../src/lib/defaultRoles.js";
import * as clientsService from "../src/modules/clients/service.js";
import { createTestOrganization, createTestUser, ensurePermissionsSeeded } from "./helpers.js";

/**
 * Décision #1 (actée avant la phase d'architecture) : `finalStatus` du dossier
 * client reste modifiable par défaut par Administrateur + Agent RDV assigné au
 * dossier, jamais par un autre utilisateur. Vérifié dans modules/clients/service.ts.
 */
describe("permission clients.editFinalStatus", () => {
  let admin: Awaited<ReturnType<typeof createTestUser>>;
  let agentRdvAssigned: Awaited<ReturnType<typeof createTestUser>>;
  let agentRdvOther: Awaited<ReturnType<typeof createTestUser>>;
  let calliste: Awaited<ReturnType<typeof createTestUser>>;
  let clientId: string;

  beforeAll(async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Permissions");
    admin = await createTestUser(org.id, ADMINISTRATOR_ROLE_NAME);
    agentRdvAssigned = await createTestUser(org.id, "Agent RDV");
    agentRdvOther = await createTestUser(org.id, "Agent RDV");
    calliste = await createTestUser(org.id, "Agent calliste");

    const status = await admin.db.configurableListItem.findFirstOrThrow({ where: { listKey: "CALL_STATUS" } });
    const call = await admin.db.call.create({
      data: {
        organizationId: admin.authUser.organizationId,
        userId: calliste.user.id,
        direction: "OUTBOUND",
        type: "PROSPECTION",
        statusId: status.id,
        fromNumber: "+33000000000",
        toNumber: "+33000000009",
        occurredAt: new Date(),
      },
    });

    const country = await admin.db.configurableListItem.findFirstOrThrow({ where: { listKey: "CLIENT_COUNTRY" } });

    const client = await clientsService.createClient(admin.db, admin.authUser, {
      callId: call.id,
      agentId: agentRdvAssigned.user.id,
      phoneNumber: "+33000000009",
      countryKey: country.key,
    });
    clientId = client.id;
  });

  it("l'agent RDV assigné au dossier peut modifier le statut final", async () => {
    const finalStatus = await agentRdvAssigned.db.configurableListItem.findFirstOrThrow({
      where: { listKey: "CLIENT_FINAL_STATUS", isDefault: false },
    });

    const updated = await clientsService.updateClient(agentRdvAssigned.db, agentRdvAssigned.authUser, clientId, {
      finalStatusKey: finalStatus.key,
    });

    expect(updated.finalStatusId).toBe(finalStatus.id);
  });

  it("un agent RDV non assigné à ce dossier ne peut pas le modifier", async () => {
    await expect(
      clientsService.updateClient(agentRdvOther.db, agentRdvOther.authUser, clientId, {
        finalStatusKey: "EN_COURS",
      }),
    ).rejects.toThrow();
  });

  it("un agent calliste (permission absente de son rôle) ne peut pas modifier le statut final", async () => {
    await expect(
      clientsService.updateClient(calliste.db, calliste.authUser, clientId, {
        finalStatusKey: "EN_COURS",
      }),
    ).rejects.toThrow();
  });

  it("l'administrateur peut modifier le statut final même sans être l'agent assigné", async () => {
    const finalStatus = await admin.db.configurableListItem.findFirstOrThrow({
      where: { listKey: "CLIENT_FINAL_STATUS", isDefault: true },
    });

    const updated = await clientsService.updateClient(admin.db, admin.authUser, clientId, {
      finalStatusKey: finalStatus.key,
    });

    expect(updated.finalStatusId).toBe(finalStatus.id);
  });

  /**
   * Gap trouvé et corrigé au lot 4 : réassigner `agentId` n'était soumis à aucune
   * permission — un télephoniste (accès en écriture générique sur son propre
   * dossier) pouvait se réassigner lui-même le dossier puis, dans une deuxième
   * requête, éditer finalStatus en tant qu'"agent assigné". Contourne complètement
   * la règle si non bloqué explicitement.
   */
  it("le télephoniste créateur ne peut pas se réassigner le dossier pour contourner la règle", async () => {
    const status = await calliste.db.configurableListItem.findFirstOrThrow({ where: { listKey: "CALL_STATUS" } });
    const call = await calliste.db.call.create({
      data: {
        organizationId: calliste.authUser.organizationId,
        userId: calliste.user.id,
        direction: "OUTBOUND",
        type: "PROSPECTION",
        statusId: status.id,
        fromNumber: "+33000000000",
        toNumber: "+33000000010",
        occurredAt: new Date(),
      },
    });
    const country = await calliste.db.configurableListItem.findFirstOrThrow({ where: { listKey: "CLIENT_COUNTRY" } });

    // le télephoniste (calliste) crée le dossier et l'assigne à agentRdvAssigned — pas à lui-même
    const otherClient = await clientsService.createClient(calliste.db, calliste.authUser, {
      callId: call.id,
      agentId: agentRdvAssigned.user.id,
      phoneNumber: "+33000000010",
      countryKey: country.key,
    });

    // tentative de réassignation à soi-même — doit être rejetée (pas de clients.viewAll)
    await expect(
      clientsService.updateClient(calliste.db, calliste.authUser, otherClient.id, {
        agentId: calliste.user.id,
      }),
    ).rejects.toThrow();

    // l'assignation n'a pas bougé
    const stillAssignedToOriginal = await calliste.db.client.findUniqueOrThrow({ where: { id: otherClient.id } });
    expect(stillAssignedToOriginal.agentId).toBe(agentRdvAssigned.user.id);

    // et donc finalStatus reste hors de portée du télephoniste, même après la tentative
    await expect(
      clientsService.updateClient(calliste.db, calliste.authUser, otherClient.id, {
        finalStatusKey: "EN_COURS",
      }),
    ).rejects.toThrow();
  });

  /**
   * Gap trouvé en vérifiant §P0.4 en direct dans le navigateur au lot 4 (pas par ce
   * fichier — ces tests appellent updateClient() directement, en contournant
   * `PATCH /clients/:id`, donc ils ne pouvaient pas voir un bug au niveau de la route)
   * : le endpoint exigeait `clients.update` pour TOUTE requête, y compris une qui ne
   * touche que finalStatusKey. Le rôle "Agent RDV" n'a délibérément que
   * `clients.editFinalStatus`, pas `clients.update` — donc Robin (l'agent RDV
   * réellement assigné) recevait un 403 en essayant de sauvegarder le statut final
   * depuis l'écran, alors que la règle métier dit qu'il devrait pouvoir. Route
   * corrigée pour accepter `clients.update` OU `clients.editFinalStatus`
   * (requireAnyPermission) ; ce test vérifie la contrepartie côté service qui
   * referme ce que la route a dû élargir : un profil avec SEULEMENT
   * clients.editFinalStatus peut toucher finalStatusKey mais pas les champs
   * généraux du dossier.
   */
  it("un agent RDV assigné sans clients.update peut éditer finalStatus mais pas les champs généraux du dossier", async () => {
    const finalStatus = await agentRdvAssigned.db.configurableListItem.findFirstOrThrow({
      where: { listKey: "CLIENT_FINAL_STATUS", isDefault: false },
    });

    const updated = await clientsService.updateClient(agentRdvAssigned.db, agentRdvAssigned.authUser, clientId, {
      finalStatusKey: finalStatus.key,
    });
    expect(updated.finalStatusId).toBe(finalStatus.id);

    await expect(
      clientsService.updateClient(agentRdvAssigned.db, agentRdvAssigned.authUser, clientId, {
        adresse: "12 rue tentée sans clients.update",
      }),
    ).rejects.toThrow();
  });
});
