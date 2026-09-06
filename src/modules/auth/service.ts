import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../../db/prisma.js";
import { Unauthorized } from "../../lib/httpError.js";
import {
  refreshTokenExpiryDate,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../../lib/jwt.js";
import type { LoginInput } from "./schema.js";

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
