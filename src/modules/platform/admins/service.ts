import bcrypt from "bcryptjs";
import { prisma } from "../../../db/prisma.js";
import { Conflict, Forbidden, NotFound } from "../../../lib/httpError.js";
import type { AuthenticatedPlatformAdmin } from "../../../types/express.js";
import type { CreatePlatformAdminInput, SetPlatformAdminStatusInput, UpdatePlatformAdminInput } from "./schema.js";

/**
 * Gestion des comptes Super Admin eux-mêmes (§5.29 sous-lot 3), avec les mêmes
 * deux garde-fous que /users (§2.2) — nettement plus simples ici : un Super Admin
 * est binaire (pas de rôles/permissions à considérer), donc "dernier gestionnaire
 * actif" se réduit à "dernier PlatformAdmin actif", sans la nuance par permission
 * qu'exigeait /users (voir modules/users/service.ts pour le rappel de cette
 * distinction et pourquoi elle ne s'applique pas ici).
 */
function sanitizePlatformAdmin<T extends { password: string }>(admin: T): Omit<T, "password"> {
  const { password, ...rest } = admin;
  return rest;
}

async function assertEmailAvailable(email: string, excludeId?: string) {
  const existing = await prisma.platformAdmin.findUnique({ where: { email } });
  if (existing && existing.id !== excludeId) {
    throw Conflict("Un compte Super Admin utilise déjà cet e-mail");
  }
}

export async function listAdmins() {
  const admins = await prisma.platformAdmin.findMany({ orderBy: { email: "asc" } });
  return admins.map(sanitizePlatformAdmin);
}

export async function createAdmin(input: CreatePlatformAdminInput) {
  await assertEmailAvailable(input.email);

  const hashedPassword = await bcrypt.hash(input.password, 10);
  const admin = await prisma.platformAdmin.create({
    data: {
      email: input.email,
      password: hashedPassword,
      name: input.name ?? null,
      // Voir schema.prisma : le créateur tape ce mot de passe directement (pas
      // d'infra d'e-mail disponible), donc un changement est exigé à la 1re connexion.
      mustChangePassword: true,
    },
  });

  return sanitizePlatformAdmin(admin);
}

export async function updateAdmin(id: string, input: UpdatePlatformAdminInput) {
  const existing = await prisma.platformAdmin.findUnique({ where: { id } });
  if (!existing) throw NotFound("Super Admin introuvable");
  if (input.email) await assertEmailAvailable(input.email, id);

  const admin = await prisma.platformAdmin.update({
    where: { id },
    data: {
      email: input.email ?? existing.email,
      name: input.name ?? existing.name,
    },
  });

  return sanitizePlatformAdmin(admin);
}

export async function setAdminStatus(
  id: string,
  input: SetPlatformAdminStatusInput,
  actingAdmin: AuthenticatedPlatformAdmin,
) {
  const existing = await prisma.platformAdmin.findUnique({ where: { id } });
  if (!existing) throw NotFound("Super Admin introuvable");

  if (!input.isActive) {
    if (id === actingAdmin.id) {
      throw Forbidden("Vous ne pouvez pas désactiver votre propre compte");
    }

    const otherActiveCount = await prisma.platformAdmin.count({
      where: { isActive: true, id: { not: id } },
    });
    if (otherActiveCount === 0) {
      throw Conflict("Impossible de désactiver le dernier Super Admin actif");
    }
  }

  const admin = await prisma.platformAdmin.update({ where: { id }, data: { isActive: input.isActive } });

  if (!input.isActive) {
    // Coupure immédiate, même logique que la suspension d'organisation (sous-lot 2) :
    // ne pas laisser une session déjà ouverte fonctionner encore 15 minutes.
    await prisma.platformSession.updateMany({
      where: { platformAdminId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  return sanitizePlatformAdmin(admin);
}
