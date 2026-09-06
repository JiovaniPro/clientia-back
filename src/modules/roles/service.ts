import type { ScopedPrismaClient } from "../../db/scopedClient.js";
import { AuditAction } from "../../generated/prisma/enums.js";
import { recordAuditLog } from "../../lib/auditLog.js";
import { BadRequest, Conflict, NotFound } from "../../lib/httpError.js";
import type { AuthenticatedUser } from "../../types/express.js";
import type { CreateRoleInput, UpdateRoleInput } from "./schema.js";

/** `Permission` est un catalogue global, jamais scopé — lu via `db.permission` normalement,
 * l'extension de scoping laisse ce modèle intact (voir db/scopedClient.ts). */
async function resolvePermissionIds(db: ScopedPrismaClient, keys: string[]): Promise<string[]> {
  if (keys.length === 0) return [];
  const permissions = await db.permission.findMany({ where: { key: { in: keys } }, select: { id: true, key: true } });
  const found = new Set(permissions.map((p) => p.key));
  const missing = keys.filter((key) => !found.has(key));
  if (missing.length > 0) {
    throw BadRequest(`Permissions inconnues : ${missing.join(", ")}`);
  }
  return permissions.map((p) => p.id);
}

export async function listRoles(db: ScopedPrismaClient) {
  return db.role.findMany({
    orderBy: { name: "asc" },
    include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } },
  });
}

export async function listPermissionsCatalog(db: ScopedPrismaClient) {
  return db.permission.findMany({ orderBy: [{ module: "asc" }, { label: "asc" }] });
}

export async function createRole(db: ScopedPrismaClient, user: AuthenticatedUser, input: CreateRoleInput) {
  const existing = await db.role.findFirst({ where: { name: input.name } });
  if (existing) throw Conflict("Un rôle porte déjà ce nom");

  const permissionIds = await resolvePermissionIds(db, input.permissionKeys);

  const role = await db.role.create({
    data: {
      organizationId: user.organizationId,
      name: input.name,
      description: input.description ?? null,
      color: input.color ?? null,
      permissions: { create: permissionIds.map((permissionId) => ({ permissionId })) },
    },
    include: { permissions: { include: { permission: true } } },
  });

  await recordAuditLog(db, { userId: user.id, action: AuditAction.ROLE_CREATED, entity: "Role", entityId: role.id });
  return role;
}

export async function updateRole(
  db: ScopedPrismaClient,
  user: AuthenticatedUser,
  id: string,
  input: UpdateRoleInput,
) {
  const existing = await db.role.findUnique({ where: { id } });
  if (!existing) throw NotFound("Rôle introuvable");
  // isSystem : éditable (nom/description/permissions...) — seule la suppression est bloquée, voir deleteRole.

  const permissionIds = input.permissionKeys ? await resolvePermissionIds(db, input.permissionKeys) : null;

  const role = await db.$transaction(async (tx) => {
    if (permissionIds) {
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      if (permissionIds.length > 0) {
        await tx.rolePermission.createMany({ data: permissionIds.map((permissionId) => ({ roleId: id, permissionId })) });
      }
    }

    return tx.role.update({
      where: { id },
      data: {
        name: input.name ?? existing.name,
        description: input.description ?? existing.description,
        color: input.color ?? existing.color,
      },
      include: { permissions: { include: { permission: true } } },
    });
  });

  await recordAuditLog(db, { userId: user.id, action: AuditAction.ROLE_UPDATED, entity: "Role", entityId: id });
  return role;
}

export async function deleteRole(db: ScopedPrismaClient, user: AuthenticatedUser, id: string) {
  const existing = await db.role.findUnique({ where: { id }, include: { _count: { select: { users: true } } } });
  if (!existing) throw NotFound("Rôle introuvable");
  if (existing.isSystem) throw BadRequest("Les rôles système ne peuvent pas être supprimés");
  if (existing._count.users > 0) throw Conflict("Ce rôle est encore assigné à des utilisateurs");

  await db.role.delete({ where: { id } });
  await recordAuditLog(db, { userId: user.id, action: AuditAction.ROLE_DELETED, entity: "Role", entityId: id });
}
