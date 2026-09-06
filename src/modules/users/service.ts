import type { ScopedPrismaClient } from "../../db/scopedClient.js";
import type { ListUsersQuery } from "./schema.js";

/**
 * Lot minimal (§débloque le sélecteur d'agent par nom sur CreateClientDossierModal
 * et le filtre agentId de /clients) — pas encore le CRUD complet (création,
 * édition, désactivation) qui viendra avec l'écran d'administration des
 * utilisateurs. Champs volontairement limités : jamais `password`, jamais
 * d'autre organisation (scopé via `db.user`, voir db/scopedClient.ts).
 *
 * `search` (§C2, sélecteur de participant interne) : comparaison simple
 * insensible à la casse sur prénom/nom/email pris séparément — pas de recherche
 * multi-mots sur "prénom nom" combinés (ex. "Camille Calliste" en une seule
 * requête ne matchera pas si aucun des deux champs pris seul ne contient toute la
 * chaîne), volontairement laissé simple pour ce lot minimal.
 */
export async function listUsers(db: ScopedPrismaClient, query: ListUsersQuery) {
  return db.user.findMany({
    where: {
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.role ? { role: { name: query.role } } : {}),
      ...(query.search
        ? {
            OR: [
              { firstName: { contains: query.search, mode: "insensitive" } },
              { lastName: { contains: query.search, mode: "insensitive" } },
              { email: { contains: query.search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      isActive: true,
      role: { select: { id: true, name: true } },
    },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
  });
}
