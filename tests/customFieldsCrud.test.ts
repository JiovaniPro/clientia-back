import { describe, expect, it } from "vitest";
import { HttpError } from "../src/lib/httpError.js";
import * as customFieldsService from "../src/modules/customFields/service.js";
import { createTestOrganization, createTestUser, ensurePermissionsSeeded } from "./helpers.js";

/** §5.23 sous-lot A — lecture + création des définitions de champs personnalisés. */
describe("création d'une définition de champ personnalisé", () => {
  it("crée un champ texte simple", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org CustomFields Create");
    const admin = await createTestUser(org.id, "Administrateur");

    const definition = await customFieldsService.createDefinition(admin.db, admin.authUser, {
      entityType: "CLIENT",
      key: "SOURCE_PROSPECT",
      label: "Source du prospect",
      fieldType: "TEXT",
    });

    expect(definition.isActive).toBe(true);
    expect(definition.isRequired).toBe(false);
  });

  it("crée un champ à choix (SELECT) avec ses options", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org CustomFields Create Select");
    const admin = await createTestUser(org.id, "Administrateur");

    const definition = await customFieldsService.createDefinition(admin.db, admin.authUser, {
      entityType: "CLIENT",
      key: "CANAL_ACQUISITION",
      label: "Canal d'acquisition",
      fieldType: "SELECT",
      options: ["Salon", "Recommandation", "Publicité"],
    });

    expect(definition.options).toEqual(["Salon", "Recommandation", "Publicité"]);
  });

  it("refuse un champ SELECT sans aucune option", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org CustomFields Create Select No Options");
    const admin = await createTestUser(org.id, "Administrateur");

    await expect(
      customFieldsService.createDefinition(admin.db, admin.authUser, {
        entityType: "CLIENT",
        key: "CANAL_SANS_OPTIONS",
        label: "Sans options",
        fieldType: "SELECT",
      }),
    ).rejects.toThrow('nécessite au moins une option');
  });

  it("refuse un type d'entité non pris en charge", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org CustomFields Create Bad Entity");
    const admin = await createTestUser(org.id, "Administrateur");

    await expect(
      customFieldsService.createDefinition(admin.db, admin.authUser, {
        entityType: "CALL",
        key: "X",
        label: "X",
        fieldType: "TEXT",
      }),
    ).rejects.toThrow(HttpError);
  });

  it("refuse une clé déjà utilisée pour ce type d'entité", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org CustomFields Create Duplicate");
    const admin = await createTestUser(org.id, "Administrateur");

    await customFieldsService.createDefinition(admin.db, admin.authUser, {
      entityType: "CLIENT",
      key: "DOUBLON",
      label: "Premier",
      fieldType: "TEXT",
    });

    await expect(
      customFieldsService.createDefinition(admin.db, admin.authUser, {
        entityType: "CLIENT",
        key: "DOUBLON",
        label: "Second",
        fieldType: "TEXT",
      }),
    ).rejects.toThrow("Cette clé existe déjà pour ce type d'entité");
  });
});

describe("lecture des définitions", () => {
  it("liste les définitions actives pour un type d'entité, isolées par organisation", async () => {
    await ensurePermissionsSeeded();
    const orgA = await createTestOrganization("Org CustomFields List A");
    const orgB = await createTestOrganization("Org CustomFields List B");
    const adminA = await createTestUser(orgA.id, "Administrateur");
    const adminB = await createTestUser(orgB.id, "Administrateur");

    await customFieldsService.createDefinition(adminA.db, adminA.authUser, {
      entityType: "CLIENT",
      key: "CHAMP_ORG_A",
      label: "Champ de l'org A",
      fieldType: "TEXT",
    });

    const listA = await customFieldsService.listDefinitions(adminA.db, "CLIENT");
    const listB = await customFieldsService.listDefinitions(adminB.db, "CLIENT");

    expect(listA.some((d) => d.key === "CHAMP_ORG_A")).toBe(true);
    expect(listB.some((d) => d.key === "CHAMP_ORG_A")).toBe(false);
  });

  it("masque les définitions désactivées par défaut, les inclut avec includeInactive", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org CustomFields List Inactive");
    const admin = await createTestUser(org.id, "Administrateur");
    const definition = await customFieldsService.createDefinition(admin.db, admin.authUser, {
      entityType: "CLIENT",
      key: "CHAMP_A_DESACTIVER",
      label: "À désactiver",
      fieldType: "TEXT",
    });
    await customFieldsService.updateDefinition(admin.db, admin.authUser, definition.id, { isActive: false });

    const activeOnly = await customFieldsService.listDefinitions(admin.db, "CLIENT");
    const withInactive = await customFieldsService.listDefinitions(admin.db, "CLIENT", { includeInactive: true });

    expect(activeOnly.some((d) => d.key === "CHAMP_A_DESACTIVER")).toBe(false);
    expect(withInactive.some((d) => d.key === "CHAMP_A_DESACTIVER")).toBe(true);
  });
});

describe("§5.23 sous-lot C — activer / désactiver", () => {
  it("désactiver retire le champ des formulaires de saisie sans supprimer les valeurs déjà écrites", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org CustomFields Deactivate");
    const admin = await createTestUser(org.id, "Administrateur");
    const definition = await customFieldsService.createDefinition(admin.db, admin.authUser, {
      entityType: "CLIENT",
      key: "SUIVI",
      label: "Suivi",
      fieldType: "TEXT",
    });

    const deactivated = await customFieldsService.updateDefinition(admin.db, admin.authUser, definition.id, {
      isActive: false,
    });
    expect(deactivated.isActive).toBe(false);

    const stillThere = await admin.db.customFieldDefinition.findUnique({ where: { id: definition.id } });
    expect(stillThere).not.toBeNull();
  });

  it("réactiver un champ le fait réapparaître dans la liste par défaut", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org CustomFields Reactivate");
    const admin = await createTestUser(org.id, "Administrateur");
    const definition = await customFieldsService.createDefinition(admin.db, admin.authUser, {
      entityType: "CLIENT",
      key: "REACTIVABLE",
      label: "Réactivable",
      fieldType: "TEXT",
    });
    await customFieldsService.updateDefinition(admin.db, admin.authUser, definition.id, { isActive: false });

    const reactivated = await customFieldsService.updateDefinition(admin.db, admin.authUser, definition.id, {
      isActive: true,
    });
    expect(reactivated.isActive).toBe(true);

    const activeList = await customFieldsService.listDefinitions(admin.db, "CLIENT");
    expect(activeList.some((d) => d.key === "REACTIVABLE")).toBe(true);
  });
});

describe("§5.23 sous-lot B — modification d'une définition de champ personnalisé", () => {
  it("met à jour le libellé, la section, l'ordre et le caractère obligatoire", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org CustomFields Update");
    const admin = await createTestUser(org.id, "Administrateur");
    const definition = await customFieldsService.createDefinition(admin.db, admin.authUser, {
      entityType: "CLIENT",
      key: "A_MODIFIER",
      label: "Avant modification",
      fieldType: "TEXT",
    });

    const updated = await customFieldsService.updateDefinition(admin.db, admin.authUser, definition.id, {
      label: "Après modification",
      section: "Informations complémentaires",
      order: 5,
      isRequired: true,
    });

    expect(updated.label).toBe("Après modification");
    expect(updated.section).toBe("Informations complémentaires");
    expect(updated.order).toBe(5);
    expect(updated.isRequired).toBe(true);
  });

  it("met à jour les options d'un champ à choix", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org CustomFields Update Options");
    const admin = await createTestUser(org.id, "Administrateur");
    const definition = await customFieldsService.createDefinition(admin.db, admin.authUser, {
      entityType: "CLIENT",
      key: "CHOIX_A_MODIFIER",
      label: "Choix",
      fieldType: "SELECT",
      options: ["A", "B"],
    });

    const updated = await customFieldsService.updateDefinition(admin.db, admin.authUser, definition.id, {
      options: ["A", "B", "C"],
    });

    expect(updated.options).toEqual(["A", "B", "C"]);
  });

  it("refuse de vider les options d'un champ à choix (la modification ne peut pas casser le champ)", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org CustomFields Update Empty Options");
    const admin = await createTestUser(org.id, "Administrateur");
    const definition = await customFieldsService.createDefinition(admin.db, admin.authUser, {
      entityType: "CLIENT",
      key: "CHOIX_VIDE",
      label: "Choix",
      fieldType: "MULTISELECT",
      options: ["A"],
    });

    await expect(
      customFieldsService.updateDefinition(admin.db, admin.authUser, definition.id, { options: [] }),
    ).rejects.toThrow('nécessite au moins une option');

    const stillThere = await admin.db.customFieldDefinition.findUniqueOrThrow({ where: { id: definition.id } });
    expect(stillThere.options).toEqual(["A"]);
  });

  it("refuse un id inexistant", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org CustomFields Update Missing");
    const admin = await createTestUser(org.id, "Administrateur");

    await expect(
      customFieldsService.updateDefinition(admin.db, admin.authUser, "definition-inexistante", { label: "X" }),
    ).rejects.toThrow(HttpError);
  });
});
