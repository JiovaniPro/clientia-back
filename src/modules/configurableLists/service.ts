import type { ScopedPrismaClient } from "../../db/scopedClient.js";
import type { ConfigurableListItemModel } from "../../generated/prisma/models.js";
import { AuditAction } from "../../generated/prisma/enums.js";
import { recordAuditLog } from "../../lib/auditLog.js";
import { Conflict, NotFound } from "../../lib/httpError.js";
import type { AuthenticatedUser } from "../../types/express.js";
import type { CreateListItemInput, UpdateListItemInput } from "./schema.js";

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
