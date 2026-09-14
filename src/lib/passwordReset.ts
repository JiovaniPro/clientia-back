import crypto from "node:crypto";

/**
 * Sous-lot "Utilisateurs" — §2.2 : liens de réinitialisation plutôt qu'un mot de
 * passe tapé par l'admin (création ET réinitialisation utilisent ce même
 * mécanisme). Le jeton BRUT n'est jamais stocké — seul son hash SHA-256 l'est
 * (`PasswordResetToken.tokenHash`), pour qu'une fuite de la table ne permette pas
 * de réutiliser un lien déjà envoyé.
 */
const TOKEN_BYTES = 32;
export const RESET_TOKEN_TTL_HOURS = 24;

export function generateResetToken(): { rawToken: string; tokenHash: string } {
  const rawToken = crypto.randomBytes(TOKEN_BYTES).toString("hex");
  return { rawToken, tokenHash: hashResetToken(rawToken) };
}

export function hashResetToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

export function resetTokenExpiryDate(): Date {
  return new Date(Date.now() + RESET_TOKEN_TTL_HOURS * 60 * 60 * 1000);
}

/**
 * Pas de nouvelle variable d'env dédiée : `CORS_ORIGIN` EST déjà l'URL du
 * frontend (c'est ce qu'elle protège) — premier de la liste si plusieurs origines
 * sont autorisées.
 */
export function buildResetLink(rawToken: string): string {
  const base = (process.env.CORS_ORIGIN ?? "http://localhost:3000").split(",")[0]!.trim();
  return `${base}/reset-password?token=${rawToken}`;
}
