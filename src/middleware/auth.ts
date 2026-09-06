import type { RequestHandler } from "express";
import { prisma } from "../db/prisma.js";
import { verifyAccessToken } from "../lib/jwt.js";
import { Unauthorized } from "../lib/httpError.js";

/**
 * Recharge systématiquement user -> role -> permissions à chaque requête (pas de
 * cache pour l'instant) : le JWT ne porte que `sub`, donc un rôle modifié par un
 * admin est immédiatement pris en compte à la requête suivante. Voir §3 du plan.
 *
 * Lit UNIQUEMENT `Authorization: Bearer` — aucun repli sur un cookie. C'est ce qui
 * rend cette API résistante au CSRF sans middleware dédié (voir la décision de
 * sécurité documentée dans app.ts, juste avant le montage des routeurs) : garder
 * cette absence de repli cookie est ce qui tient toute cette garantie debout.
 */
export const authMiddleware: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    next(Unauthorized());
    return;
  }

  try {
    const payload = verifyAccessToken(header.slice("Bearer ".length));

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        organization: { select: { isActive: true } },
        role: {
          include: {
            permissions: { include: { permission: { select: { key: true } } } },
          },
        },
      },
    });

    if (!user || !user.isActive || !user.organization.isActive) {
      next(Unauthorized());
      return;
    }

    req.user = {
      id: user.id,
      organizationId: user.organizationId,
      email: user.email,
      roleId: user.roleId,
      permissions: user.role.permissions.map((rp) => rp.permission.key),
    };

    next();
  } catch {
    next(Unauthorized("Session invalide ou expirée"));
  }
};
