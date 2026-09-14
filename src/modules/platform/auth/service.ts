import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../../../db/prisma.js";
import { Unauthorized } from "../../../lib/httpError.js";
import {
  refreshTokenExpiryDate,
  signPlatformAccessToken,
  signPlatformRefreshToken,
  verifyPlatformRefreshToken,
} from "../../../lib/jwt.js";
import type { PlatformLoginInput } from "./schema.js";

interface SessionMeta {
  userAgent: string | undefined;
  ipAddress: string | undefined;
}

/**
 * Miroir de modules/auth/service.ts, mais entièrement sur `PlatformAdmin`/
 * `PlatformSession` — jamais `User`/`Session`. Toujours via `prisma` non scopé :
 * un Super Admin n'a pas d'organizationId, `getScopedClient` ne s'applique pas ici.
 */
function buildPlatformAuthPayload(platformAdmin: {
  id: string;
  email: string;
  name: string | null;
  mustChangePassword: boolean;
}) {
  return {
    platformAdmin: {
      id: platformAdmin.id,
      email: platformAdmin.email,
      name: platformAdmin.name,
      mustChangePassword: platformAdmin.mustChangePassword,
    },
  };
}

async function createPlatformSession(platformAdminId: string, meta: SessionMeta) {
  const sessionId = randomUUID();
  const refreshToken = signPlatformRefreshToken(platformAdminId, sessionId);
  await prisma.platformSession.create({
    data: {
      id: sessionId,
      platformAdminId,
      refreshToken,
      userAgent: meta.userAgent ?? null,
      ipAddress: meta.ipAddress ?? null,
      expiresAt: refreshTokenExpiryDate(),
    },
  });
  return refreshToken;
}

export async function login(input: PlatformLoginInput, meta: SessionMeta) {
  const platformAdmin = await prisma.platformAdmin.findUnique({ where: { email: input.email } });
  if (!platformAdmin || !platformAdmin.isActive) {
    throw Unauthorized("Identifiants invalides");
  }

  const passwordMatches = await bcrypt.compare(input.password, platformAdmin.password);
  if (!passwordMatches) {
    throw Unauthorized("Identifiants invalides");
  }

  const accessToken = signPlatformAccessToken(platformAdmin.id);
  const refreshToken = await createPlatformSession(platformAdmin.id, meta);
  return { accessToken, refreshToken, ...buildPlatformAuthPayload(platformAdmin) };
}

export async function refresh(refreshToken: string, meta: SessionMeta) {
  let payload: ReturnType<typeof verifyPlatformRefreshToken>;
  try {
    payload = verifyPlatformRefreshToken(refreshToken);
  } catch {
    throw Unauthorized("Session invalide ou expirée");
  }

  const session = await prisma.platformSession.findUnique({ where: { refreshToken } });
  if (!session || session.revokedAt || session.expiresAt < new Date() || session.id !== payload.sessionId) {
    throw Unauthorized("Session invalide ou expirée");
  }

  const platformAdmin = await prisma.platformAdmin.findUnique({ where: { id: payload.sub } });
  if (!platformAdmin || !platformAdmin.isActive) {
    throw Unauthorized("Session invalide ou expirée");
  }

  // rotation : l'ancienne session est révoquée, une nouvelle est émise
  await prisma.platformSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });

  const accessToken = signPlatformAccessToken(platformAdmin.id);
  const newRefreshToken = await createPlatformSession(platformAdmin.id, meta);
  return { accessToken, refreshToken: newRefreshToken, ...buildPlatformAuthPayload(platformAdmin) };
}

export async function logout(refreshToken: string) {
  await prisma.platformSession.updateMany({
    where: { refreshToken, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function me(platformAdminId: string) {
  const platformAdmin = await prisma.platformAdmin.findUniqueOrThrow({ where: { id: platformAdminId } });
  return buildPlatformAuthPayload(platformAdmin);
}

/**
 * §5.29 sous-lot 3 — un Super Admin créé par un autre tape un mot de passe initial
 * (pas d'infra d'e-mail disponible pour un compte sans organisation, voir
 * PlatformAdmin.mustChangePassword au schéma) : ce changement est la contrepartie
 * obligatoire. Exige l'ancien mot de passe même en sortie de `mustChangePassword`
 * (défense contre une session déjà authentifiée volée qui changerait le mot de
 * passe sans le connaître) et révoque toutes les autres sessions actives, comme
 * pour la réinitialisation côté organisation (modules/auth/service.ts).
 */
export async function changeOwnPassword(platformAdminId: string, currentPassword: string, newPassword: string) {
  const platformAdmin = await prisma.platformAdmin.findUniqueOrThrow({ where: { id: platformAdminId } });

  const passwordMatches = await bcrypt.compare(currentPassword, platformAdmin.password);
  if (!passwordMatches) {
    throw Unauthorized("Mot de passe actuel incorrect");
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);
  await prisma.$transaction([
    prisma.platformAdmin.update({
      where: { id: platformAdminId },
      data: { password: hashedPassword, mustChangePassword: false },
    }),
    prisma.platformSession.updateMany({
      where: { platformAdminId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
}
