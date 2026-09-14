import { prisma } from "./prisma.js";

/**
 * Modèles métier portant `organizationId` en propre — la portée y est injectée
 * directement par le client scopé ci-dessous (voir §2 du plan d'architecture).
 */
const TENANT_SCOPED_MODELS = new Set([
  "Role",
  "ConfigurableListItem",
  "CustomFieldDefinition",
  "User",
  "Call",
  "Reminder",
  "Notification",
  "Setting",
  "AuditLog",
  "Client",
  "Calendar",
  "CalendarEvent",
  "EventCategory",
  "EmailTemplate",
  "EmailHistory",
  "EmailQueue",
]);

/**
 * Modèles de jonction/historique sans `organizationId` en propre, scopés
 * indirectement via un filtre relationnel injecté sur leur parent (Prisma sait
 * filtrer `where: { <relation>: { organizationId } }` à travers une relation
 * to-one). Centralisé ici plutôt que laissé à la discipline de chaque route :
 * toute future route qui adresserait un de ces modèles par ID en lecture/update/delete
 * hérite automatiquement de la portée, sans jointure à réécrire au cas par cas.
 *
 * ⚠️ ASYMÉTRIE CREATE — POINT DE VIGILANCE OBLIGATOIRE POUR TOUTE NOUVELLE ROUTE :
 * cette protection ne couvre QUE findMany/findUnique/findFirst/count/aggregate/
 * groupBy/update/updateMany/delete/deleteMany (voir WHERE_SCOPED_OPERATIONS
 * ci-dessous). Un `create` sur un de ces modèles n'est PAS vérifié ici — Prisma n'a
 * pas de clause "refuse si la ligne parente référencée n'appartient pas à X" côté
 * create. Toute route qui crée une ligne d'un de ces modèles DOIT d'abord relire
 * son parent via le client scopé (ex: `db.call.findUnique({ where: { id: callId } })`
 * avant `db.callStatusHistory.create(...)`) pour garantir que le parent référencé
 * appartient bien à l'organisation courante. C'est déjà le cas partout aujourd'hui
 * (voir calls/service.ts::changeCallStatus, roles/service.ts::createRole/updateRole)
 * — mais ce n'est PAS structurellement garanti par ce fichier, contrairement au
 * côté lecture. Avant d'ajouter une route de création touchant un de ces modèles,
 * vérifier explicitement que le parent est bien relu via `req.db` (jamais un ID
 * transmis tel quel par le client) avant l'écriture.
 *
 * `CustomFieldValue` est délibérément absent de cette liste : `entityId` est un
 * String brut polymorphe, sans relation Prisma à travers laquelle filtrer — son
 * isolation reste assurée par `assertEntityBelongsToOrg` dans
 * modules/customFields/service.ts (même point de vigilance : lecture ET écriture
 * y sont gardées manuellement, faute de mécanisme centralisé possible ici).
 */
const RELATION_SCOPED_MODELS: Record<string, string> = {
  CallStatusHistory: "call",
  CalendarEventStatusHistory: "event",
  EventAttendee: "event",
  EventReminder: "event",
  EventReminderFiring: "event",
  EventConflict: "event",
  RolePermission: "role",
  PasswordResetToken: "user",
};

const WHERE_SCOPED_OPERATIONS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "delete",
  "deleteMany",
]);

const DATA_SCOPED_OPERATIONS = new Set(["create", "createMany"]);

// biome-ignore lint: args shape varies per operation, typed loosely on purpose here
type OperationArgs = Record<string, any>;

/**
 * Construit un client Prisma dont toute requête sur un modèle tenant-scoped est
 * automatiquement filtrée/marquée par `organizationId`. Attaché à `req.db` par le
 * middleware `tenant` (src/middleware/tenant.ts) — jamais instancié directement
 * dans une route.
 */
export function getScopedClient(organizationId: string) {
  return prisma.$extends({
    name: "tenant-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const relationField = model ? RELATION_SCOPED_MODELS[model] : undefined;

          if (relationField) {
            // Pas de colonne organizationId à filtrer/injecter directement ici : on
            // passe par le parent (ex: where: { call: { organizationId } }). Ne couvre
            // que le côté lecture/update/delete — un create fait toujours confiance à
            // l'appelant pour avoir déjà vérifié le parent via le client scopé (c'est
            // le cas partout aujourd'hui : voir calls/service.ts, roles/service.ts).
            if (WHERE_SCOPED_OPERATIONS.has(operation)) {
              const scopedArgs: OperationArgs = args ?? {};
              scopedArgs.where = { ...(scopedArgs.where ?? {}), [relationField]: { organizationId } };
              return query(scopedArgs);
            }
            return query(args);
          }

          if (!model || !TENANT_SCOPED_MODELS.has(model)) {
            return query(args);
          }

          const scopedArgs: OperationArgs = args ?? {};

          if (WHERE_SCOPED_OPERATIONS.has(operation)) {
            scopedArgs.where = { ...(scopedArgs.where ?? {}), organizationId };
          } else if (DATA_SCOPED_OPERATIONS.has(operation)) {
            if (operation === "createMany" && Array.isArray(scopedArgs.data)) {
              scopedArgs.data = scopedArgs.data.map((row: OperationArgs) => ({ ...row, organizationId }));
            } else {
              scopedArgs.data = { ...scopedArgs.data, organizationId };
            }
          } else if (operation === "upsert") {
            scopedArgs.where = { ...(scopedArgs.where ?? {}), organizationId };
            scopedArgs.create = { ...scopedArgs.create, organizationId };
          }

          return query(scopedArgs);
        },
      },
    },
  });
}

export type ScopedPrismaClient = ReturnType<typeof getScopedClient>;
