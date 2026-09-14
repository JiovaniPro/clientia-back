import type { ScopedPrismaClient } from "../../db/scopedClient.js";
import { Prisma } from "../../generated/prisma/client.js";
import type { ConfigurableListItemModel } from "../../generated/prisma/models.js";
import { AuditAction } from "../../generated/prisma/enums.js";
import { recordAuditLog } from "../../lib/auditLog.js";
import {
  BEHAVIOR_FLAGS_CATALOG,
  CONFIGURABLE_LIST_KEYS,
  isKnownListKey,
  knownBehaviorFlagKeys,
} from "../../lib/configurableListsCatalog.js";
import { BadRequest, Conflict, NotFound } from "../../lib/httpError.js";
import type { AuthenticatedUser } from "../../types/express.js";
import type { CreateListItemInput, UpdateListItemInput } from "./schema.js";

function assertValidListKey(listKey: string) {
  if (!isKnownListKey(listKey)) {
    throw BadRequest(`Liste inconnue : "${listKey}" (attendu : ${CONFIGURABLE_LIST_KEYS.join(", ")})`);
  }
}

function assertKnownBehaviorFlags(listKey: string, metadata: Record<string, boolean> | undefined) {
  if (!metadata) return;
  const known = knownBehaviorFlagKeys(listKey);
  const unknown = Object.keys(metadata).filter((key) => !known.has(key));
  if (unknown.length > 0) {
    throw BadRequest(`Drapeau(x) comportemental(aux) inconnu(s) pour "${listKey}" : ${unknown.join(", ")}`);
  }
}

export function listBehaviorFlagsCatalog() {
  return BEHAVIOR_FLAGS_CATALOG;
}

export async function listAllConfigurableLists(db: ScopedPrismaClient): Promise<Record<string, ConfigurableListItemModel[]>> {
  const items = await db.configurableListItem.findMany({ orderBy: [{ listKey: "asc" }, { order: "asc" }] });
  const grouped: Record<string, ConfigurableListItemModel[]> = {};
  for (const item of items) {
    (grouped[item.listKey] ??= []).push(item);
  }
  return grouped;
}

export async function listItemsForKey(db: ScopedPrismaClient, listKey: string) {
  return db.configurableListItem.findMany({ where: { listKey }, orderBy: { order: "asc" } });
}

export async function createListItem(db: ScopedPrismaClient, user: AuthenticatedUser, input: CreateListItemInput) {
  assertValidListKey(input.listKey);
  assertKnownBehaviorFlags(input.listKey, input.metadata);

  const existing = await db.configurableListItem.findFirst({ where: { listKey: input.listKey, key: input.key } });
  if (existing) throw Conflict("Cette clé existe déjà dans cette liste");

  const item = await db.configurableListItem.create({
    data: {
      organizationId: user.organizationId,
      listKey: input.listKey,
      key: input.key,
      label: input.label,
      color: input.color ?? null,
      order: input.order ?? 0,
      isDefault: input.isDefault ?? false,
      ...(input.metadata ? { metadata: input.metadata } : {}),
    },
  });

  await recordAuditLog(db, {
    userId: user.id,
    action: AuditAction.CONFIGURABLE_LIST_ITEM_CREATED,
    entity: "ConfigurableListItem",
    entityId: item.id,
  });
  return item;
}

export async function updateListItem(
  db: ScopedPrismaClient,
  user: AuthenticatedUser,
  id: string,
  input: UpdateListItemInput,
) {
  const existing = await db.configurableListItem.findUnique({ where: { id } });
  if (!existing) throw NotFound("Valeur introuvable");
  assertKnownBehaviorFlags(existing.listKey, input.metadata);

  const item = await db.configurableListItem.update({
    where: { id },
    data: {
      label: input.label ?? existing.label,
      color: input.color ?? existing.color,
      order: input.order ?? existing.order,
      isActive: input.isActive ?? existing.isActive,
      isDefault: input.isDefault ?? existing.isDefault,
      ...(input.metadata ? { metadata: input.metadata } : {}),
    },
  });

  await recordAuditLog(db, {
    userId: user.id,
    action: AuditAction.CONFIGURABLE_LIST_ITEM_UPDATED,
    entity: "ConfigurableListItem",
    entityId: id,
  });
  return item;
}

/**
 * Suppression physique, §5.22 sous-lot C. Contrairement à `CustomFieldDefinition`
 * (relation `onDelete: Cascade`, garde-fou applicatif explicite requis), les 8
 * relations entrantes de `ConfigurableListItem` (Call, CallStatusHistory ×2,
 * Client ×6 — voir schema.prisma) n'ont pas de `onDelete` déclaré : Postgres
 * refuse nativement la suppression si une ligne y fait référence. On tente donc
 * la suppression et on traduit l'erreur de contrainte (P2003) en un message
 * clair — pas besoin de récrire 8 requêtes de comptage comme pour les rôles.
 */
export async function deleteListItem(db: ScopedPrismaClient, user: AuthenticatedUser, id: string) {
  const existing = await db.configurableListItem.findUnique({ where: { id } });
  if (!existing) throw NotFound("Valeur introuvable");

  // Garde-fou applicatif complémentaire, pas couvert par la contrainte DB : la
  // valeur par défaut d'une liste est requise à la création d'un appel/dossier
  // client (voir resolveDefaultItemId dans modules/clients/service.ts) même si
  // elle n'est encore référencée par aucune ligne existante.
  if (existing.isDefault) {
    throw Conflict("Cette valeur est la valeur par défaut de sa liste, elle ne peut pas être supprimée");
  }

  try {
    await db.configurableListItem.delete({ where: { id } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      throw Conflict("Cette valeur est encore utilisée par des enregistrements existants");
    }
    throw error;
  }

  await recordAuditLog(db, {
    userId: user.id,
    action: AuditAction.CONFIGURABLE_LIST_ITEM_DELETED,
    entity: "ConfigurableListItem",
    entityId: id,
  });
}
