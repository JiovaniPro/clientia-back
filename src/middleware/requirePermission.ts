import type { RequestHandler } from "express";
import { Forbidden, Unauthorized } from "../lib/httpError.js";

/** Remplace `requireRole(...)` — vérifie une clé de permission dynamique (§3 du plan). */
export function requirePermission(key: string): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      next(Unauthorized());
      return;
    }
    if (!req.user.permissions.includes(key)) {
      next(Forbidden(`Permission requise : ${key}`));
      return;
    }
    next();
  };
}

/**
 * Variante OR : passe si l'utilisateur a AU MOINS UNE des clés. Sert pour les routes
 * qui recouvrent plusieurs granularités métier sous un seul verbe HTTP — ex.
 * `PATCH /clients/:id` accepte à la fois une mise à jour générale (`clients.update`)
 * et une mise à jour du seul statut final (`clients.editFinalStatus`, §P0.4), portée
 * par un rôle qui n'a délibérément pas `clients.update` (Agent RDV). Ce gate est
 * volontairement large ; c'est au service (modules/clients/service.ts) de vérifier,
 * champ par champ, laquelle des deux permissions autorise réellement le contenu de la
 * requête — ne pas relâcher ce gate sans ajouter la contrepartie côté service.
 */
export function requireAnyPermission(keys: string[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      next(Unauthorized());
      return;
    }
    if (!keys.some((key) => req.user!.permissions.includes(key))) {
      next(Forbidden(`Permission requise : une de [${keys.join(", ")}]`));
      return;
    }
    next();
  };
}
