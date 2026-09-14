import { describe, expect, it } from "vitest";
import * as clientsService from "../src/modules/clients/service.js";
import * as configurableListsService from "../src/modules/configurableLists/service.js";
import { createTestOrganization, createTestUser, ensurePermissionsSeeded } from "./helpers.js";

/**
 * §5.22 sous-lot C — suppression physique d'un item de liste configurable, avec
 * garde-fou. Contrairement à CustomFieldDefinition (tests/customFields.test.ts),
 * le garde-fou ici vient nativement de la contrainte de clé étrangère Postgres
 * (aucun `onDelete` déclaré sur les 8 relations entrantes de ConfigurableListItem)
 * — testé sur DEUX relations différentes pour prouver que la traduction de
 * l'erreur P2003 ne dépend pas d'une seule table précise.
 */
async function createTestCall(user: Awaited<ReturnType<typeof createTestUser>>, organizationId: string, statusId: string) {
  return user.db.call.create({
    data: {
      organizationId,
      userId: user.user.id,
      direction: "OUTBOUND",
      type: "PROSPECTION",
      statusId,
      fromNumber: "+33000000000",
      toNumber: "+33000000099",
      occurredAt: new Date(),
    },
  });
}

describe("suppression d'un item de liste configurable — garde-fou par contrainte DB", () => {
  it("refuse la suppression d'un statut d'appel référencé par un Call (relation Call.statusId)", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Lists Delete Guard Call");
    const admin = await createTestUser(org.id, "Administrateur");

    const status = await configurableListsService.createListItem(admin.db, admin.authUser, {
      listKey: "CALL_STATUS",
      key: "STATUT_REFERENCE_PAR_APPEL",
      label: "Référencé par un appel",
    });
    await createTestCall(admin, org.id, status.id);

    await expect(configurableListsService.deleteListItem(admin.db, admin.authUser, status.id)).rejects.toThrow(
      "Cette valeur est encore utilisée par des enregistrements existants",
    );

    const stillThere = await admin.db.configurableListItem.findUnique({ where: { id: status.id } });
    expect(stillThere).not.toBeNull();
  });

  it("refuse la suppression d'un pays référencé par un Client (relation Client.countryId, une relation DIFFÉRENTE)", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Lists Delete Guard Client");
    const admin = await createTestUser(org.id, "Administrateur");

    const country = await configurableListsService.createListItem(admin.db, admin.authUser, {
      listKey: "CLIENT_COUNTRY",
      key: "PAYS_REFERENCE_PAR_CLIENT",
      label: "Référencé par un client",
    });
    const defaultStatus = await admin.db.configurableListItem.findFirstOrThrow({
      where: { listKey: "CALL_STATUS", isDefault: true },
    });
    const call = await createTestCall(admin, org.id, defaultStatus.id);
    await clientsService.createClient(admin.db, admin.authUser, {
      callId: call.id,
      agentId: admin.user.id,
      phoneNumber: "+33000000099",
      countryKey: country.key,
    });

    await expect(configurableListsService.deleteListItem(admin.db, admin.authUser, country.id)).rejects.toThrow(
      "Cette valeur est encore utilisée par des enregistrements existants",
    );

    const stillThere = await admin.db.configurableListItem.findUnique({ where: { id: country.id } });
    expect(stillThere).not.toBeNull();
  });

  it("refuse la suppression de la valeur par défaut d'une liste, même si elle n'est encore référencée par rien", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Lists Delete Guard Default");
    const admin = await createTestUser(org.id, "Administrateur");

    const defaultCountry = await admin.db.configurableListItem.findFirstOrThrow({
      where: { listKey: "CLIENT_COUNTRY", isDefault: true },
    });

    await expect(
      configurableListsService.deleteListItem(admin.db, admin.authUser, defaultCountry.id),
    ).rejects.toThrow("Cette valeur est la valeur par défaut de sa liste, elle ne peut pas être supprimée");
  });

  it("supprime une valeur jamais utilisée et non marquée par défaut", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Lists Delete Ok");
    const admin = await createTestUser(org.id, "Administrateur");

    const item = await configurableListsService.createListItem(admin.db, admin.authUser, {
      listKey: "CALL_STATUS",
      key: "JAMAIS_UTILISE",
      label: "Jamais utilisé",
    });

    await configurableListsService.deleteListItem(admin.db, admin.authUser, item.id);

    const stillThere = await admin.db.configurableListItem.findUnique({ where: { id: item.id } });
    expect(stillThere).toBeNull();
  });

  it("refuse un id inexistant", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Lists Delete Missing");
    const admin = await createTestUser(org.id, "Administrateur");

    await expect(
      configurableListsService.deleteListItem(admin.db, admin.authUser, "item-inexistant"),
    ).rejects.toThrow("Valeur introuvable");
  });
});
