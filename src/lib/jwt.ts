import jwt from "jsonwebtoken";

/**
 * Payload volontairement minimal : `{ sub: userId }`, jamais de rôle/permissions
 * embarqués (voir §3 du plan) — dynamiques et mutables en base, un JWT à durée de
 * vie même courte pourrait sinon porter un droit déjà révoqué par un admin.
 */
export interface AccessTokenPayload {
  sub: string;
}

export interface RefreshTokenPayload {
  sub: string;
  sessionId: string;
}

const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_TTL_DAYS = 30;

function requireSecret(
  name: "JWT_ACCESS_SECRET" | "JWT_REFRESH_SECRET" | "JWT_PLATFORM_ACCESS_SECRET" | "JWT_PLATFORM_REFRESH_SECRET",
): string {
  const secret = process.env[name];
  if (!secret) {
    throw new Error(`${name} manquant dans l'environnement`);
  }
  return secret;
}

export function signAccessToken(userId: string): string {
  return jwt.sign({ sub: userId } satisfies AccessTokenPayload, requireSecret("JWT_ACCESS_SECRET"), {
    expiresIn: ACCESS_TOKEN_TTL,
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, requireSecret("JWT_ACCESS_SECRET")) as AccessTokenPayload;
}

export function signRefreshToken(userId: string, sessionId: string): string {
  return jwt.sign({ sub: userId, sessionId } satisfies RefreshTokenPayload, requireSecret("JWT_REFRESH_SECRET"), {
    expiresIn: `${REFRESH_TOKEN_TTL_DAYS}d`,
  });
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, requireSecret("JWT_REFRESH_SECRET")) as RefreshTokenPayload;
}

export function refreshTokenExpiryDate(): Date {
  const date = new Date();
  date.setDate(date.getDate() + REFRESH_TOKEN_TTL_DAYS);
  return date;
}

/**
 * §5.29 — jetons Super Admin, signés avec des secrets ENTIÈREMENT SÉPARÉS de ceux
 * ci-dessus. Ce n'est pas une variante de `AccessTokenPayload` : un token plateforme
 * doit être structurellement incapable d'être vérifié par `verifyAccessToken` (et
 * inversement) — un secret différent suffit à le garantir, indépendamment de toute
 * discipline de code par ailleurs. Voir middleware/platformAuth.ts.
 */
export interface PlatformAccessTokenPayload {
  sub: string;
}

export interface PlatformRefreshTokenPayload {
  sub: string;
  sessionId: string;
}

export function signPlatformAccessToken(platformAdminId: string): string {
  return jwt.sign(
    { sub: platformAdminId } satisfies PlatformAccessTokenPayload,
    requireSecret("JWT_PLATFORM_ACCESS_SECRET"),
    { expiresIn: ACCESS_TOKEN_TTL },
  );
}

export function verifyPlatformAccessToken(token: string): PlatformAccessTokenPayload {
  return jwt.verify(token, requireSecret("JWT_PLATFORM_ACCESS_SECRET")) as PlatformAccessTokenPayload;
}

export function signPlatformRefreshToken(platformAdminId: string, sessionId: string): string {
  return jwt.sign(
    { sub: platformAdminId, sessionId } satisfies PlatformRefreshTokenPayload,
    requireSecret("JWT_PLATFORM_REFRESH_SECRET"),
    { expiresIn: `${REFRESH_TOKEN_TTL_DAYS}d` },
  );
}

export function verifyPlatformRefreshToken(token: string): PlatformRefreshTokenPayload {
  return jwt.verify(token, requireSecret("JWT_PLATFORM_REFRESH_SECRET")) as PlatformRefreshTokenPayload;
}
