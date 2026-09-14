import { describe, expect, it } from "vitest";
import { HttpError } from "../src/lib/httpError.js";
import * as clientsService from "../src/modules/clients/service.js";
import * as customFieldsService from "../src/modules/customFields/service.js";
import { createTestOrganization, createTestUser, ensurePermissionsSeeded } from "./helpers.js";

/**
 * Garde-fou ajouté après audit (priorité avant §5.22/§5.23) : `CustomFieldDefinition`
 * a une relation `onDelete: Cascade` vers `CustomFieldValue` — sans vérification
 * explicite, supprimer une définition détruit silencieusement les valeurs déjà
 * saisies sur de vrais dossiers clients. Ce fichier prouve que ce n'est plus le cas.
 */
async function createTestClientFor(user: Awaited<ReturnType<typeof createTestUser>>, organizationId: string) {
  const status = await user.db.configurableListItem.findFirstOrThrow({
    where: { listKey: "CALL_STATUS", isDefault: true },
  });
  const call = await user.db.call.create({
    data: {
      organizationId,
      userId: user.user.id,
      direction: "OUTBOUND",
      type: "PROSPECTION",
      statusId: status.id,
      fromNumber: "+33000000000",
      toNumber: "+33000000099",
      occurredAt: new Date(),
    },
  });
  const country = await user.db.configurableListItem.findFirstOrThrow({ where: { listKey: "CLIENT_COUNTRY" } });
  return clientsService.createClient(user.db, user.authUser, {
    callId: call.id,
    agentId: user.user.id,
    phoneNumber: "+33000000099",
    countryKey: country.key,
  });
}

describe("garde-fou — suppression d'un champ personnalisé déjà utilisé", () => {
  it("refuse la suppression si une valeur existe déjà sur un dossier client", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org CustomFields Delete Guard");
    const admin = await createTestUser(org.id, "Administrateur");
    const client = await createTestClientFor(admin, org.id);

    const definition = await customFieldsService.createDefinition(admin.db, admin.authUser, {
      entityType: "CLIENT",
      key: "SOURCE_PROSPECT",
      label: "Source du prospect",
      fieldType: "TEXT",
    });

    await customFieldsService.setValuesForEntity(admin.db, "CLIENT", client.id, {
      values: [{ definitionId: definition.id, value: "Salon professionnel" }],
    });

    await expect(customFieldsService.deleteDefinition(admin.db, admin.authUser, definition.id)).rejects.toThrow(
      "Ce champ personnalisé a déjà des valeurs saisies, il ne peut pas être supprimé",
    );

    // La preuve qui compte le plus : la définition ET la valeur existent toujours,
    // rien n'a été perdu silencieusement.
    const stillThere = await admin.db.customFieldDefinition.findUnique({ where: { id: definition.id } });
    expect(stillThere).not.toBeNull();
    const values = await customFieldsService.getValuesForEntity(admin.db, "CLIENT", client.id);
    expect(values.find((v) => v.definitionId === definition.id)?.value).toBe("Salon professionnel");
  });

  it("supprime une définition jamais utilisée", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org CustomFields Delete Ok");
    const admin = await createTestUser(org.id, "Administrateur");

    const definition = await customFieldsService.createDefinition(admin.db, admin.authUser, {
      entityType: "CLIENT",
      key: "CHAMP_JAMAIS_UTILISE",
      label: "Jamais rempli",
      fieldType: "TEXT",
    });

    await customFieldsService.deleteDefinition(admin.db, admin.authUser, definition.id);

    const stillThere = await admin.db.customFieldDefinition.findUnique({ where: { id: definition.id } });
    expect(stillThere).toBeNull();
  });

  it("refuse un id de définition inexistant", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org CustomFields Delete Missing");
    const admin = await createTestUser(org.id, "Administrateur");

    await expect(
      customFieldsService.deleteDefinition(admin.db, admin.authUser, "definition-inexistante"),
    ).rejects.toThrow(HttpError);
  });
});
