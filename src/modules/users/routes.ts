import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.js";
import { requireAnyPermission, requirePermission } from "../../middleware/requirePermission.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { requireParam } from "../../lib/params.js";
import { createUserSchema, listUsersQuerySchema, setUserStatusSchema, updateUserSchema } from "./schema.js";
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

usersRouter.post("/", requirePermission("users.create"), async (req, res, next) => {
  try {
    const input = createUserSchema.parse(req.body);
    res.status(201).json(await usersService.createUser(req.db!, req.user!, input));
  } catch (error) {
    next(error);
  }
});

usersRouter.patch("/:id", requirePermission("users.update"), async (req, res, next) => {
  try {
    const input = updateUserSchema.parse(req.body);
    res.json(await usersService.updateUser(req.db!, req.user!, requireParam(req, "id"), input));
  } catch (error) {
    next(error);
  }
});

usersRouter.patch("/:id/status", requirePermission("users.deactivate"), async (req, res, next) => {
  try {
    const input = setUserStatusSchema.parse(req.body);
    res.json(await usersService.setUserStatus(req.db!, req.user!, requireParam(req, "id"), input));
  } catch (error) {
    next(error);
  }
});

/**
 * Gate `users.update` — pas de clé dédiée dans le catalogue pour ce sous-lot
 * (voir permissionsCatalog.ts : seuls view/create/update/deactivate existaient
 * avant ce lot) ; réinitialiser un mot de passe est traité comme une modification
 * du compte.
 */
usersRouter.post("/:id/reset-password", requirePermission("users.update"), async (req, res, next) => {
  try {
    await usersService.requestPasswordReset(req.db!, req.user!, requireParam(req, "id"));
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});
