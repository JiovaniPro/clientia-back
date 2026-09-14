import type { RequestHandler } from "express";
import { prisma } from "../db/prisma.js";
import { Unauthorized } from "../lib/httpError.js";
import { verifyPlatformAccessToken } from "../lib/jwt.js";

/**
 * Équivalent de middleware/auth.ts, mais pour les Super Admins (§5.29) —
 * INTENTIONNELLEMENT un fichier séparé, jamais fusionné avec auth.ts :
 *  - vérifie le token avec `verifyPlatformAccessToken` (secret distinct, voir lib/jwt.ts) ;
 *  - recharge `PlatformAdmin`, jamais `User` ;
 *  - pose `req.platformAdmin`, jamais `req.user`.
 * Aucune route montée derrière ce middleware ne doit AUSSI monter `authMiddleware`,
 * `tenantMiddleware` ou `requirePermission` — ces trois-là lisent `req.user`, que ce
 * middleware ne pose jamais. Voir tests/platformIsolation.test.ts pour la preuve.
 */
export const platformAuthMiddleware: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    next(Unauthorized());
    return;
  }

  try {
    const payload = verifyPlatformAccessToken(header.slice("Bearer ".length));

    const platformAdmin = await prisma.platformAdmin.findUnique({ where: { id: payload.sub } });
    if (!platformAdmin || !platformAdmin.isActive) {
      next(Unauthorized());
      return;
    }

    req.platformAdmin = { id: platformAdmin.id, email: platformAdmin.email };
    next();
  } catch {
    next(Unauthorized("Session invalide ou expirée"));
  }
};
