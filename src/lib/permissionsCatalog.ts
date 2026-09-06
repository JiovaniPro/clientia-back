/**
 * Catalogue global des permissions — source unique de vérité, consommée par :
 *  - prisma/seed.ts (seed du catalogue `Permission`, jamais scopé par organisation)
 *  - middleware/requirePermission.ts (les clés utilisées dans les routes doivent exister ici)
 *  - la console Super Admin / l'écran de gestion des rôles (regroupement par `module`)
 *
 * Ajouter une permission : l'ajouter ici, puis relancer le seed (idempotent, voir upsert
 * dans seed.ts) — ne jamais créer de ligne `Permission` ailleurs dans le code.
 */

export interface PermissionDefinition {
  key: string;
  module: string;
  label: string;
  description?: string;
}

export const PERMISSIONS_CATALOG: PermissionDefinition[] = [
  // --- Appels ---
  { key: "calls.view", module: "Appels", label: "Voir les appels" },
  { key: "calls.viewAll", module: "Appels", label: "Voir les appels de tous les utilisateurs" },
  { key: "calls.create", module: "Appels", label: "Créer un appel" },
  { key: "calls.update", module: "Appels", label: "Modifier un appel" },
  { key: "calls.delete", module: "Appels", label: "Supprimer un appel" },
  { key: "calls.import", module: "Appels", label: "Importer un fichier d'appels" },

  // --- Clients (dossiers) ---
  { key: "clients.view", module: "Clients", label: "Voir les dossiers clients" },
  { key: "clients.viewAll", module: "Clients", label: "Voir les dossiers de tous les utilisateurs" },
  { key: "clients.create", module: "Clients", label: "Créer un dossier client" },
  { key: "clients.update", module: "Clients", label: "Modifier un dossier client" },
  { key: "clients.delete", module: "Clients", label: "Supprimer un dossier client" },
  {
    key: "clients.editFinalStatus",
    module: "Clients",
    label: "Modifier le statut final du dossier",
    description: "Par défaut : Administrateur + Agent RDV assigné au dossier.",
  },
  {
    key: "clients.viewAdminNote",
    module: "Clients",
    label: "Voir la note interne administrateur",
  },

  // --- Calendrier / Rendez-vous ---
  { key: "calendar.view", module: "Calendrier", label: "Voir le calendrier" },
  { key: "calendar.viewAll", module: "Calendrier", label: "Voir les calendriers de tous les utilisateurs" },
  { key: "calendar.create", module: "Calendrier", label: "Créer un événement" },
  { key: "calendar.update", module: "Calendrier", label: "Modifier un événement" },
  { key: "calendar.delete", module: "Calendrier", label: "Supprimer un événement" },
  {
    key: "calendar.manageAppointments",
    module: "Calendrier",
    label: "Gérer les rendez-vous (confirmer, refuser, annuler)",
  },

  // --- Rappels ---
  { key: "reminders.view", module: "Rappels", label: "Voir les rappels" },
  { key: "reminders.create", module: "Rappels", label: "Créer un rappel" },
  { key: "reminders.update", module: "Rappels", label: "Modifier un rappel" },
  { key: "reminders.delete", module: "Rappels", label: "Supprimer un rappel" },

  // --- Notifications ---
  { key: "notifications.view", module: "Notifications", label: "Voir ses notifications" },

  // --- E-mails ---
  { key: "emails.send", module: "E-mails", label: "Envoyer un e-mail manuellement" },
  { key: "emails.viewHistory", module: "E-mails", label: "Voir l'historique des e-mails" },
  { key: "emails.manageTemplates", module: "E-mails", label: "Gérer les modèles d'e-mail" },

  // --- Utilisateurs ---
  { key: "users.view", module: "Utilisateurs", label: "Voir les utilisateurs" },
  { key: "users.create", module: "Utilisateurs", label: "Créer un utilisateur" },
  { key: "users.update", module: "Utilisateurs", label: "Modifier un utilisateur" },
  { key: "users.deactivate", module: "Utilisateurs", label: "Activer / désactiver un utilisateur" },

  // --- Administration dynamique ---
  { key: "roles.manage", module: "Administration", label: "Gérer les rôles et permissions" },
  {
    key: "configurableLists.manage",
    module: "Administration",
    label: "Gérer les listes configurables (statuts, pays...)",
  },
  { key: "customFields.manage", module: "Administration", label: "Gérer les champs personnalisés" },
  {
    key: "organization.manageSettings",
    module: "Administration",
    label: "Gérer les paramètres de l'organisation",
  },

  // --- Rapports & audit ---
  { key: "reports.view", module: "Rapports", label: "Voir les rapports" },
  { key: "auditLog.view", module: "Audit", label: "Consulter le journal d'audit" },
];
