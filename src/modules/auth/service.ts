import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../../db/prisma.js";
import { getScopedClient } from "../../db/scopedClient.js";
import { AuditAction } from "../../generated/prisma/enums.js";
import { recordAuditLog } from "../../lib/auditLog.js";
import { Unauthorized } from "../../lib/httpError.js";
import {
  refreshTokenExpiryDate,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../../lib/jwt.js";
import { hashResetToken } from "../../lib/passwordReset.js";
import type { ConfirmPasswordResetInput, LoginInput } from "./schema.js";

interface SessionMeta {
  userAgent: string | undefined;
  ipAddress: string | undefined;
}

async function buildAuthPayload(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      organization: { select: { id: true, name: true, slug: true } },
      role: { include: { permissions: { include: { permission: { select: { key: true } } } } } },
    },
  });

  return {
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      roleId: user.roleId,
      roleName: user.role.name,
      permissions: user.role.permissions.map((rp) => rp.permission.key),
      organization: user.organization,
    },
  };
}

async function createSession(userId: string, meta: SessionMeta) {
  const sessionId = randomUUID();
  const refreshToken = signRefreshToken(userId, sessionId);
  await prisma.session.create({
    data: {
      id: sessionId,
      userId,
      refreshToken,
      userAgent: meta.userAgent ?? null,
      ipAddress: meta.ipAddress ?? null,
      expiresAt: refreshTokenExpiryDate(),
    },
  });
  return refreshToken;
}

export async function login(input: LoginInput, meta: SessionMeta) {
  const organization = await prisma.organization.findUnique({ where: { slug: input.organizationSlug } });
  if (!organization || !organization.isActive) {
    throw Unauthorized("Identifiants invalides");
  }

  const user = await prisma.user.findUnique({
    where: { organizationId_email: { organizationId: organization.id, email: input.email } },
  });
  if (!user || !user.isActive) {
    throw Unauthorized("Identifiants invalides");
  }

  const passwordMatches = await bcrypt.compare(input.password, user.password);
  if (!passwordMatches) {
    throw Unauthorized("Identifiants invalides");
  }

  const accessToken = signAccessToken(user.id);
  const refreshToken = await createSession(user.id, meta);
  const payload = await buildAuthPayload(user.id);
  return { accessToken, refreshToken, ...payload };
}

export async function refresh(refreshToken: string, meta: SessionMeta) {
  let payload: ReturnType<typeof verifyRefreshToken>;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw Unauthorized("Session invalide ou expirée");
  }

  const session = await prisma.session.findUnique({ where: { refreshToken } });
  if (!session || session.revokedAt || session.expiresAt < new Date() || session.id !== payload.sessionId) {
    throw Unauthorized("Session invalide ou expirée");
  }

  // rotation : l'ancienne session est révoquée, une nouvelle est émise
  await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });

  const accessToken = signAccessToken(payload.sub);
  const newRefreshToken = await createSession(payload.sub, meta);
  const authPayload = await buildAuthPayload(payload.sub);
  return { accessToken, refreshToken: newRefreshToken, ...authPayload };
}

export async function logout(refreshToken: string) {
  await prisma.session.updateMany({
    where: { refreshToken, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function me(userId: string) {
  return buildAuthPayload(userId);
}

/**
 * Public par nécessité (l'utilisateur qui clique le lien n'est pas connecté) — voir
 * modules/users/service.ts::issuePasswordResetLink pour l'émission du jeton. Toute
 * session existante est révoquée : un mot de passe qui vient de changer ne doit pas
 * laisser d'anciennes sessions valides tourner avec l'ancien secret.
 */
export async function confirmPasswordReset(input: ConfirmPasswordResetInput) {
  const tokenHash = hashResetToken(input.token);
  const tokenRow = await prisma.passwordResetToken.findUnique({ where: { tokenHash }, include: { user: true } });
  if (!tokenRow || tokenRow.usedAt || tokenRow.expiresAt < new Date()) {
    throw Unauthorized("Lien de réinitialisation invalide ou expiré");
  }

  const hashedPassword = await bcrypt.hash(input.newPassword, 10);
  await prisma.$transaction([
    prisma.user.update({ where: { id: tokenRow.userId }, data: { password: hashedPassword } }),
    prisma.passwordResetToken.update({ where: { id: tokenRow.id }, data: { usedAt: new Date() } }),
    prisma.session.updateMany({ where: { userId: tokenRow.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);

  // Client scopé construit ad hoc (pas de req.db avant authentification) — même
  // pattern que les jobs cron (voir jobs/eventReminders.ts), uniquement pour que
  // recordAuditLog reçoive l'organizationId attendu.
  const db = getScopedClient(tokenRow.user.organizationId);
  await recordAuditLog(db, {
    userId: tokenRow.userId,
    action: AuditAction.PASSWORD_RESET,
    entity: "User",
    entityId: tokenRow.userId,
    meta: { triggeredBy: "user" },
  });
}
