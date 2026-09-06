import { PERMISSIONS_CATALOG } from "./permissionsCatalog.js";

/**
 * Les 3 rôles système provisionnés à la création d'une organisation
 * (voir organizations/defaultData.ts). `isSystem: true` empêche la suppression
 * mais pas l'édition — une organisation peut retirer une permission par défaut.
 *
 * `calendar.create` gate à la fois la création d'un Calendar (conteneur) ET d'un
 * CalendarEvent (voir modules/calendar/routes.ts — même clé pour les deux
 * ressources). Ni Agent calliste ni Agent RDV ne l'avaient avant le sous-lot A du
 * Calendrier Pro (§5.14) : comme aucun calendrier personnel n'est auto-provisionné
 * à la création d'un utilisateur, ni l'un ni l'autre ne pouvait créer le moindre
 * événement — seul l'Administrateur le pouvait. Oubli de configuration du rôle
 * système, pas une règle métier voulue (rien dans le cahier des charges ne
 * réserve la création d'événements à l'admin) — ajouté aux deux rôles.
 */

const ALL_PERMISSION_KEYS = PERMISSIONS_CATALOG.map((p) => p.key);

/** Nom stable du rôle système Administrateur — utilisé pour le retrouver sans indexation de tableau. */
export const ADMINISTRATOR_ROLE_NAME = "Administrateur";

export interface DefaultRoleDefinition {
  name: string;
  description: string;
  color: string;
  permissionKeys: string[];
}

export const DEFAULT_ROLES: DefaultRoleDefinition[] = [
  {
    name: ADMINISTRATOR_ROLE_NAME,
    description: "Accès complet à l'organisation.",
    color: "#2F5D50",
    permissionKeys: ALL_PERMISSION_KEYS,
  },
  {
    name: "Agent calliste",
    description: "Passe les appels, qualifie les prospects, crée les dossiers clients.",
    color: "#8A6D3B",
    permissionKeys: [
      "calls.view",
      "calls.create",
      "calls.update",
      "calls.import",
      "clients.view",
      "clients.create",
      "clients.update",
      "reminders.view",
      "reminders.create",
      "reminders.update",
      "reminders.delete",
      "notifications.view",
      "calendar.view",
      "calendar.create",
      "emails.send",
      "emails.viewHistory",
    ],
  },
  {
    name: "Agent RDV",
    description: "Gère les rendez-vous et le suivi des dossiers clients assignés.",
    color: "#3B6E8F",
    permissionKeys: [
      "clients.view",
      "clients.editFinalStatus",
      "clients.viewAdminNote",
      /**
       * Gap trouvé en vérifiant en direct le changement de type d'événement vers
       * "Rendez-vous" (§C — point 3) : sans `calls.view`, le sélecteur "Appel
       * rattaché" ne peut charger aucun appel pour un Agent RDV — GET /calls
       * exige cette permission (modules/calls/routes.ts). Même classe d'oubli que
       * `calendar.create` documenté ci-dessus : rien dans le cahier des charges ne
       * justifie qu'un Agent RDV ne puisse pas voir les appels qu'il rattache à
       * ses propres rendez-vous.
       */
      "calls.view",
      "calendar.view",
      "calendar.create",
      "calendar.update",
      "calendar.manageAppointments",
      "reminders.view",
      "reminders.create",
      "reminders.update",
      "reminders.delete",
      "notifications.view",
      "emails.send",
      "emails.viewHistory",
    ],
  },
];
