import { describe, expect, it } from "vitest";
import { HttpError } from "../src/lib/httpError.js";
import * as configurableListsService from "../src/modules/configurableLists/service.js";
import { createTestOrganization, createTestUser, ensurePermissionsSeeded } from "./helpers.js";

describe("catalogue des drapeaux comportementaux", () => {
  it("expose les drapeaux connus, groupés par liste", () => {
    const catalog = configurableListsService.listBehaviorFlagsCatalog();
    expect(catalog.CALL_STATUS?.map((f) => f.key)).toEqual(
      expect.arrayContaining(["requiresRecallDate", "triggersClientDossierCreation"]),
    );
    expect(catalog.CLIENT_TYPE_RDV?.map((f) => f.key)).toEqual(["requiresAddress"]);
  });
});

describe("création d'un item de liste configurable", () => {
  it("crée un nouveau statut d'appel avec un drapeau comportemental connu", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Lists Create");
    const admin = await createTestUser(org.id, "Administrateur");

    const item = await configurableListsService.createListItem(admin.db, admin.authUser, {
      listKey: "CALL_STATUS",
      key: "RELANCE_A_J30",
      label: "Relance à J+30",
      order: 20,
      metadata: { requiresRecallDate: true },
    });

    expect(item.metadata).toEqual({ requiresRecallDate: true });
  });

  it("refuse un listKey qui n'est pas une des 8 listes connues", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Lists Bad ListKey");
    const admin = await createTestUser(org.id, "Administrateur");

    await expect(
      configurableListsService.createListItem(admin.db, admin.authUser, {
        listKey: "LISTE_INVENTEE",
        key: "X",
        label: "X",
      }),
    ).rejects.toThrow(HttpError);
  });

  it("refuse une clé de drapeau comportemental inconnue pour cette liste", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Lists Bad Flag");
    const admin = await createTestUser(org.id, "Administrateur");

    await expect(
      configurableListsService.createListItem(admin.db, admin.authUser, {
        listKey: "CALL_STATUS",
        key: "X",
        label: "X",
        metadata: { requiresRecalDate: true }, // faute de frappe volontaire
      }),
    ).rejects.toThrow('Drapeau(x) comportemental(aux) inconnu(s)');
  });

  it("refuse un drapeau valide ailleurs mais pas pour CETTE liste (pas de fuite entre listes)", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Lists Cross Flag");
    const admin = await createTestUser(org.id, "Administrateur");

    // `requiresAddress` est un drapeau connu, mais seulement pour CLIENT_TYPE_RDV, pas CALL_STATUS.
    await expect(
      configurableListsService.createListItem(admin.db, admin.authUser, {
        listKey: "CALL_STATUS",
        key: "X",
        label: "X",
        metadata: { requiresAddress: true },
      }),
    ).rejects.toThrow(HttpError);
  });

  it("refuse une clé déjà utilisée dans la même liste", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Lists Duplicate Key");
    const admin = await createTestUser(org.id, "Administrateur");

    await expect(
      configurableListsService.createListItem(admin.db, admin.authUser, {
        listKey: "CALL_STATUS",
        key: "A_CONTACTER", // déjà provisionné par défaut
        label: "Doublon",
      }),
    ).rejects.toThrow("Cette clé existe déjà dans cette liste");
  });
});

describe("modification d'un item de liste configurable", () => {
  it("met à jour le libellé, la couleur et les drapeaux comportementaux", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Lists Update");
    const admin = await createTestUser(org.id, "Administrateur");
    const item = await admin.db.configurableListItem.findFirstOrThrow({
      where: { listKey: "CALL_STATUS", key: "PAS_INTERESSE" },
    });

    const updated = await configurableListsService.updateListItem(admin.db, admin.authUser, item.id, {
      label: "Pas intéressé (mis à jour)",
      color: "#111111",
      metadata: { requiresRecallDate: true },
    });

    expect(updated.label).toBe("Pas intéressé (mis à jour)");
    expect(updated.metadata).toEqual({ requiresRecallDate: true });
  });

  it("refuse un drapeau comportemental inconnu à la modification", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Lists Update Bad Flag");
    const admin = await createTestUser(org.id, "Administrateur");
    const item = await admin.db.configurableListItem.findFirstOrThrow({ where: { listKey: "CALL_STATUS" } });

    await expect(
      configurableListsService.updateListItem(admin.db, admin.authUser, item.id, {
        metadata: { drapeauInvente: true },
      }),
    ).rejects.toThrow('Drapeau(x) comportemental(aux) inconnu(s)');
  });

  it("refuse un id inexistant", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Lists Update Missing");
    const admin = await createTestUser(org.id, "Administrateur");

    await expect(
      configurableListsService.updateListItem(admin.db, admin.authUser, "item-inexistant", { label: "X" }),
    ).rejects.toThrow(HttpError);
  });
});
