import type { ScopedPrismaClient } from "../../db/scopedClient.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { AuditAction } from "../../generated/prisma/enums.js";
import { recordAuditLog } from "../../lib/auditLog.js";
import { BadRequest, Conflict, NotFound } from "../../lib/httpError.js";
import type { AuthenticatedUser } from "../../types/express.js";
import type {
  CreateCustomFieldDefinitionInput,
  SetCustomFieldValuesInput,
  UpdateCustomFieldDefinitionInput,
} from "./schema.js";

/** Seul `CLIENT` est pris en charge en V1 (voir assertEntityBelongsToOrg ci-dessous,
 * seul point qui lit réellement les valeurs) — une définition créée pour un autre
 * type d'entité serait acceptée mais ne serait jamais lisible/écrivable. */
export const SUPPORTED_ENTITY_TYPES = ["CLIENT"] as const;

function assertSupportedEntityType(entityType: string) {
  if (!(SUPPORTED_ENTITY_TYPES as readonly string[]).includes(entityType)) {
    throw BadRequest(
      `Type d'entité non pris en charge : "${entityType}" (attendu : ${SUPPORTED_ENTITY_TYPES.join(", ")})`,
    );
  }
}

const CHOICE_FIELD_TYPES = new Set(["SELECT", "MULTISELECT"]);

function assertOptionsForChoiceFields(fieldType: string, options: string[] | undefined) {
  if (CHOICE_FIELD_TYPES.has(fieldType) && (!options || options.length === 0)) {
    throw BadRequest(`Le type "${fieldType}" nécessite au moins une option`);
  }
}

/**
 * `CustomFieldValue.entityId` est polymorphe (String brut, pas de FK) — la garantie
 * multi-tenant n'est donc pas automatique dessus. On la reconstitue ici en vérifiant
 * que l'entité ciblée appartient bien à l'organisation via son propre modèle scopé,
 * avant toute lecture/écriture de valeur. À étendre au fur et à mesure des entités
 * qui gagnent des champs personnalisés (seul `CLIENT` est pris en charge en V1).
 */
async function assertEntityBelongsToOrg(db: ScopedPrismaClient, entityType: string, entityId: string) {
  if (entityType === "CLIENT") {
    const client = await db.client.findUnique({ where: { id: entityId }, select: { id: true } });
    if (!client) throw NotFound("Entité introuvable");
    return;
  }
  throw NotFound(`Type d'entité non pris en charge : ${entityType}`);
}

export async function listDefinitions(
  db: ScopedPrismaClient,
  entityType: string,
  options: { includeInactive?: boolean } = {},
) {
  return db.customFieldDefinition.findMany({
    where: { entityType, ...(options.includeInactive ? {} : { isActive: true }) },
    orderBy: { order: "asc" },
  });
}

export async function createDefinition(
  db: ScopedPrismaClient,
  user: AuthenticatedUser,
  input: CreateCustomFieldDefinitionInput,
) {
  assertSupportedEntityType(input.entityType);
  assertOptionsForChoiceFields(input.fieldType, input.options);

  const existing = await db.customFieldDefinition.findFirst({
    where: { entityType: input.entityType, key: input.key },
  });
  if (existing) throw Conflict("Cette clé existe déjà pour ce type d'entité");

  const definition = await db.customFieldDefinition.create({
    data: {
      organizationId: user.organizationId,
      entityType: input.entityType,
      key: input.key,
      label: input.label,
      fieldType: input.fieldType,
      ...(input.options ? { options: input.options } : {}),
      isRequired: input.isRequired ?? false,
      order: input.order ?? 0,
      section: input.section ?? null,
    },
  });

  await recordAuditLog(db, {
    userId: user.id,
    action: AuditAction.CUSTOM_FIELD_CREATED,
    entity: "CustomFieldDefinition",
    entityId: definition.id,
  });
  return definition;
}

export async function updateDefinition(
  db: ScopedPrismaClient,
  user: AuthenticatedUser,
  id: string,
  input: UpdateCustomFieldDefinitionInput,
) {
  const existing = await db.customFieldDefinition.findUnique({ where: { id } });
  if (!existing) throw NotFound("Champ personnalisé introuvable");
  if (input.options !== undefined) {
    assertOptionsForChoiceFields(existing.fieldType, input.options);
  }

  const definition = await db.customFieldDefinition.update({
    where: { id },
    data: {
      label: input.label ?? existing.label,
      ...(input.options ? { options: input.options } : {}),
      isRequired: input.isRequired ?? existing.isRequired,
      order: input.order ?? existing.order,
      section: input.section ?? existing.section,
      isActive: input.isActive ?? existing.isActive,
    },
  });

  await recordAuditLog(db, {
    userId: user.id,
    action: AuditAction.CUSTOM_FIELD_UPDATED,
    entity: "CustomFieldDefinition",
    entityId: id,
  });
  return definition;
}

export async function deleteDefinition(db: ScopedPrismaClient, user: AuthenticatedUser, id: string) {
  const existing = await db.customFieldDefinition.findUnique({ where: { id } });
  if (!existing) throw NotFound("Champ personnalisé introuvable");

  // Garde-fou ajouté après audit : la relation vers CustomFieldValue est en
  // `onDelete: Cascade` (voir schema.prisma) — sans cette vérification explicite,
  // supprimer une définition détruit silencieusement toutes les valeurs déjà
  // saisies par les agents sur des dossiers clients réels. Contrairement à
  // ConfigurableListItem (§5.22), aucune contrainte DB ne bloque ce cas puisque
  // le cascade est voulu techniquement (nettoyer les valeurs orphelines quand la
  // suppression EST autorisée) — le blocage doit donc être fait au niveau service.
  const valueCount = await db.customFieldValue.count({ where: { definitionId: id } });
  if (valueCount > 0) {
    throw Conflict("Ce champ personnalisé a déjà des valeurs saisies, il ne peut pas être supprimé");
  }

  await db.customFieldDefinition.delete({ where: { id } });
  await recordAuditLog(db, {
    userId: user.id,
    action: AuditAction.CUSTOM_FIELD_DELETED,
    entity: "CustomFieldDefinition",
    entityId: id,
  });
}

export async function getValuesForEntity(db: ScopedPrismaClient, entityType: string, entityId: string) {
  await assertEntityBelongsToOrg(db, entityType, entityId);

  const definitions = await db.customFieldDefinition.findMany({ where: { entityType, isActive: true } });
  const definitionIds = definitions.map((d) => d.id);
  const values =
    definitionIds.length > 0
      ? await db.customFieldValue.findMany({ where: { definitionId: { in: definitionIds }, entityId } })
      : [];
  const valueByDefinitionId = new Map(values.map((v) => [v.definitionId, v.value]));

  return definitions.map((definition) => ({
    definitionId: definition.id,
    key: definition.key,
    label: definition.label,
    fieldType: definition.fieldType,
    value: valueByDefinitionId.get(definition.id) ?? null,
  }));
}

export async function setValuesForEntity(
  db: ScopedPrismaClient,
  entityType: string,
  entityId: string,
  input: SetCustomFieldValuesInput,
) {
  await assertEntityBelongsToOrg(db, entityType, entityId);

  const definitions = await db.customFieldDefinition.findMany({ where: { entityType } });
  const validDefinitionIds = new Set(definitions.map((d) => d.id));

  for (const entry of input.values) {
    if (!validDefinitionIds.has(entry.definitionId)) {
      throw NotFound("Champ personnalisé introuvable pour ce type d'entité");
    }
    await db.customFieldValue.upsert({
      where: { definitionId_entityId: { definitionId: entry.definitionId, entityId } },
      create: { definitionId: entry.definitionId, entityId, value: entry.value as Prisma.InputJsonValue },
      update: { value: entry.value as Prisma.InputJsonValue },
    });
  }

  return getValuesForEntity(db, entityType, entityId);
}
