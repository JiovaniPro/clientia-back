import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.js";
import { requireAnyPermission } from "../../middleware/requirePermission.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { listUsersQuerySchema } from "./schema.js";
import * as usersService from "./service.js";

export const usersRouter = Router();
usersRouter.use(authMiddleware, tenantMiddleware);

/**
 * Gate volontairement `clients.view` OU `users.view`, pas `users.view` seul : les 3
 * rôles système ont tous `clients.view`, mais aucun rôle agent (calliste, Agent RDV)
 * n'a `users.view` par défaut (réservé à l'écran d'admin des utilisateurs, pas encore
 * construit) — voir lib/defaultRoles.ts. Cet endpoint sert avant tout un annuaire
 * minimal pour les sélecteurs d'agent (création de dossier, filtre /clients), pas la
 * gestion des comptes ; le restreindre à `users.view` aurait bloqué exactement les
 * rôles qui en ont besoin. `users.view` reste accepté en OR pour un futur rôle qui
 * aurait ce droit sans avoir `clients.view`.
 */
usersRouter.get("/", requireAnyPermission(["clients.view", "users.view"]), async (req, res, next) => {
  try {
    const query = listUsersQuerySchema.parse(req.query);
    res.json(await usersService.listUsers(req.db!, query));
  } catch (error) {
    next(error);
  }
});
