import type { RequestHandler } from "express";
import { getScopedClient } from "../db/scopedClient.js";
import { Unauthorized } from "../lib/httpError.js";

/**
 * Doit toujours être monté après `authMiddleware`. Attache le client Prisma scopé
 * à `req.db` — toute route de module métier doit l'utiliser exclusivement (voir §2
 * du plan ; seules les routes `/platform/*` sont autorisées à importer `db/prisma.ts`
 * directement).
 */
export const tenantMiddleware: RequestHandler = (req, _res, next) => {
  if (!req.user) {
    next(Unauthorized());
    return;
  }
  req.db = getScopedClient(req.user.organizationId);
  next();
};
