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

function requireSecret(name: "JWT_ACCESS_SECRET" | "JWT_REFRESH_SECRET"): string {
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
