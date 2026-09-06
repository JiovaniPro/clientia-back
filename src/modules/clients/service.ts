import type { ScopedPrismaClient } from "../../db/scopedClient.js";
import { recordAuditLog } from "../../lib/auditLog.js";
import { createConfigService } from "../../lib/configService.js";
import { AuditAction } from "../../generated/prisma/enums.js";
import { BadRequest, Forbidden, NotFound } from "../../lib/httpError.js";
import type { AuthenticatedUser } from "../../types/express.js";
import type { CreateClientInput, ListClientsQuery, UpdateClientInput } from "./schema.js";

const LIST_KEYS = {
  dossierStatus: "CLIENT_DOSSIER_STATUS",
  country: "CLIENT_COUNTRY",
  civilite: "CLIENT_CIVILITE",
  maritalStatus: "CLIENT_MARITAL_STATUS",
  children: "CLIENT_CHILDREN",
  typeRdv: "CLIENT_TYPE_RDV",
  finalStatus: "CLIENT_FINAL_STATUS",
} as const;

function canViewAll(user: AuthenticatedUser): boolean {
  return user.permissions.includes("clients.viewAll");
}

function canEditFinalStatus(user: AuthenticatedUser, agentId: string): boolean {
  if (!user.permissions.includes("clients.editFinalStatus")) return false;
  // Par défaut : Administrateur (a clients.viewAll) + Agent RDV assigné au dossier.
  return canViewAll(user) || user.id === agentId;
}

function canViewAdminNote(user: AuthenticatedUser): boolean {
  return user.permissions.includes("clients.viewAdminNote");
}

/**
 * Champs "généraux" du dossier — tout ce qui n'est PAS le statut final. La route
 * `PATCH /clients/:id` accepte `clients.update` OU `clients.editFinalStatus` (voir
 * requireAnyPermission dans routes.ts), pour laisser un Agent RDV — qui n'a
 * délibérément que `clients.editFinalStatus` — atteindre ce endpoint pour éditer
 * SEULEMENT le statut final (§P0.4). Sans ce garde-fou ici, ce même agent pourrait
 * aussi glisser `dossierStatusKey`/`adresse`/etc. dans la même requête et les voir
 * appliqués sans jamais avoir eu `clients.update` — c'est ce contrôle qui referme
 * ce que le gate de route a dû élargir.
 */
const GENERAL_UPDATE_FIELDS = [
  "firstName",
  "lastName",
  "dossierStatusKey",
  "agentId",
  "phoneNumber",
  "email",
  "countryKey",
  "civiliteKey",
  "maritalStatusKey",
  "birthDate",
  "childrenKey",
  "typeRdvKey",
  "adresse",
  "comment",
] as const satisfies readonly (keyof UpdateClientInput)[];

function touchesGeneralFields(input: UpdateClientInput): boolean {
  return GENERAL_UPDATE_FIELDS.some((key) => input[key] !== undefined);
}

/**
 * Le front (ClientDetailView.tsx) affiche des relations (country.label,
 * dossierStatus.color, etc.), pas les FK brutes — utilisé aussi bien par getClient
 * que par updateClient pour que la réponse de PATCH ait exactement la même forme que
 * GET. Un update sans ce même `include` renvoie country/dossierStatus/etc. = undefined,
 * ce que loadClientIntoForm() dans ClientDetailView tente ensuite de déréférencer
 * (`client.country.label`) — crash direct après un save pourtant réussi côté serveur.
 */
const CLIENT_DETAIL_INCLUDE = {
  dossierStatus: true,
  finalStatus: true,
  country: true,
  civilite: true,
  maritalStatus: true,
  children: true,
  typeRdv: true,
  telephoniste: { select: { id: true, firstName: true, lastName: true } },
  agent: { select: { id: true, firstName: true, lastName: true } },
  call: true,
} as const;

function stripAdminNote<T extends { adminNote: string | null }>(client: T, user: AuthenticatedUser): T {
  if (canViewAdminNote(user)) return client;
  return { ...client, adminNote: null };
}

async function resolveDefaultItemId(
  config: ReturnType<typeof createConfigService>,
  listKey: string,
): Promise<string> {
  const items = await config.getListItems(listKey);
  const defaultItem = items.find((item) => item.isDefault);
  if (!defaultItem) {
    throw BadRequest(`Aucune valeur par défaut configurée pour la liste "${listKey}"`);
  }
  return defaultItem.id;
}

export async function createClient(db: ScopedPrismaClient, user: AuthenticatedUser, input: CreateClientInput) {
  const call = await db.call.findUnique({ where: { id: input.callId } });
  if (!call) throw NotFound("Appel introuvable");

  const existingClient = await db.client.findUnique({ where: { callId: input.callId } });
  if (existingClient) throw BadRequest("Un dossier client existe déjà pour cet appel");

  const config = createConfigService(db);

  const [dossierStatus, country, civilite, maritalStatus, children, typeRdv, finalStatus] = await Promise.all([
    input.dossierStatusKey
      ? config.getItemOrThrow(LIST_KEYS.dossierStatus, input.dossierStatusKey)
      : null,
    config.getItemOrThrow(LIST_KEYS.country, input.countryKey),
    input.civiliteKey ? config.getItemOrThrow(LIST_KEYS.civilite, input.civiliteKey) : null,
    input.maritalStatusKey ? config.getItemOrThrow(LIST_KEYS.maritalStatus, input.maritalStatusKey) : null,
    input.childrenKey ? config.getItemOrThrow(LIST_KEYS.children, input.childrenKey) : null,
    input.typeRdvKey ? config.getItemOrThrow(LIST_KEYS.typeRdv, input.typeRdvKey) : null,
    input.finalStatusKey ? config.getItemOrThrow(LIST_KEYS.finalStatus, input.finalStatusKey) : null,
  ]);

  const typeRdvBehavior = (typeRdv?.metadata as Record<string, boolean> | null) ?? {};
  if (typeRdvBehavior.requiresAddress && !input.adresse) {
    throw BadRequest("Une adresse est requise pour ce type de rendez-vous");
  }

  const dossierStatusId = dossierStatus?.id ?? (await resolveDefaultItemId(config, LIST_KEYS.dossierStatus));
  const finalStatusId = finalStatus?.id ?? (await resolveDefaultItemId(config, LIST_KEYS.finalStatus));

  if (input.finalStatusKey && !canEditFinalStatus(user, input.agentId)) {
    throw Forbidden("Vous ne pouvez pas définir le statut final de ce dossier");
  }

  if (input.adminNote && !canViewAdminNote(user)) {
    throw Forbidden("Vous ne pouvez pas définir la note interne de ce dossier");
  }

  const client = await db.client.create({
    data: {
      organizationId: user.organizationId,
      callId: input.callId,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      dossierStatusId,
      telephonisteId: user.id, // immuable après création
      agentId: input.agentId,
      phoneNumber: input.phoneNumber,
      email: input.email ?? null,
      countryId: country.id,
      civiliteId: civilite?.id ?? null,
      maritalStatusId: maritalStatus?.id ?? null,
      birthDate: input.birthDate ?? null,
      childrenId: children?.id ?? null,
      typeRdvId: typeRdv?.id ?? null,
      adresse: input.adresse ?? null,
      comment: input.comment ?? null,
      finalStatusId,
      adminNote: input.adminNote ?? null,
    },
  });

  await recordAuditLog(db, {
    userId: user.id,
    action: AuditAction.CLIENT_CREATED,
    entity: "Client",
    entityId: client.id,
  });

  return stripAdminNote(client, user);
}

export async function listClients(db: ScopedPrismaClient, user: AuthenticatedUser, query: ListClientsQuery) {
  const config = createConfigService(db);
  const [dossierStatus, finalStatus] = await Promise.all([
    query.dossierStatusKey ? config.getItemOrThrow(LIST_KEYS.dossierStatus, query.dossierStatusKey) : null,
    query.finalStatusKey ? config.getItemOrThrow(LIST_KEYS.finalStatus, query.finalStatusKey) : null,
  ]);

  const where: Record<string, unknown> = {};
  if (!canViewAll(user)) {
    where.OR = [{ telephonisteId: user.id }, { agentId: user.id }];
  }
  if (dossierStatus) where.dossierStatusId = dossierStatus.id;
  if (finalStatus) where.finalStatusId = finalStatus.id;
  if (query.agentId) where.agentId = query.agentId;
  if (query.search) {
    where.AND = [
      ...((where.AND as unknown[]) ?? []),
      {
        OR: [
          { firstName: { contains: query.search, mode: "insensitive" } },
          { lastName: { contains: query.search, mode: "insensitive" } },
          { phoneNumber: { contains: query.search } },
          { email: { contains: query.search, mode: "insensitive" } },
        ],
      },
    ];
  }

  const [items, total] = await db.$transaction([
    db.client.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: {
        dossierStatus: true,
        finalStatus: true,
        country: true,
        agent: { select: { id: true, firstName: true, lastName: true } },
        telephoniste: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
    db.client.count({ where }),
  ]);

  return { items: items.map((item) => stripAdminNote(item, user)), total, page: query.page, pageSize: query.pageSize };
}

export async function getClient(db: ScopedPrismaClient, user: AuthenticatedUser, id: string) {
  const client = await db.client.findUnique({
    where: { id },
    include: CLIENT_DETAIL_INCLUDE,
  });

  if (!client) throw NotFound("Dossier introuvable");
  if (!canViewAll(user) && client.telephonisteId !== user.id && client.agentId !== user.id) {
    throw Forbidden();
  }

  return stripAdminNote(client, user);
}

export async function updateClient(
  db: ScopedPrismaClient,
  user: AuthenticatedUser,
  id: string,
  input: UpdateClientInput,
) {
  const existing = await db.client.findUnique({ where: { id } });
  if (!existing) throw NotFound("Dossier introuvable");
  if (!canViewAll(user) && existing.telephonisteId !== user.id && existing.agentId !== user.id) {
    throw Forbidden();
  }

  const config = createConfigService(db);

  if (touchesGeneralFields(input) && !user.permissions.includes("clients.update")) {
    throw Forbidden("Vous ne pouvez pas modifier ce dossier");
  }
  if (input.finalStatusKey && !canEditFinalStatus(user, existing.agentId)) {
    throw Forbidden("Vous ne pouvez pas modifier le statut final de ce dossier");
  }
  if (input.adminNote !== undefined && !canViewAdminNote(user)) {
    throw Forbidden("Vous ne pouvez pas modifier la note interne de ce dossier");
  }
  // Réassigner l'agent RDV change QUI peut ensuite éditer finalStatus (§P0.4) — un
  // simple accès en écriture (télephoniste créateur, ou l'agent déjà assigné) ne
  // suffit pas à se réassigner soi-même le dossier pour contourner la règle en deux
  // temps. Seul un profil avec clients.viewAll (Admin) peut réassigner.
  if (input.agentId && input.agentId !== existing.agentId && !canViewAll(user)) {
    throw Forbidden("Vous ne pouvez pas réassigner ce dossier");
  }

  const [dossierStatus, country, civilite, maritalStatus, children, typeRdv, finalStatus] = await Promise.all([
    input.dossierStatusKey ? config.getItemOrThrow(LIST_KEYS.dossierStatus, input.dossierStatusKey) : null,
    input.countryKey ? config.getItemOrThrow(LIST_KEYS.country, input.countryKey) : null,
    input.civiliteKey ? config.getItemOrThrow(LIST_KEYS.civilite, input.civiliteKey) : null,
    input.maritalStatusKey ? config.getItemOrThrow(LIST_KEYS.maritalStatus, input.maritalStatusKey) : null,
    input.childrenKey ? config.getItemOrThrow(LIST_KEYS.children, input.childrenKey) : null,
    input.typeRdvKey ? config.getItemOrThrow(LIST_KEYS.typeRdv, input.typeRdvKey) : null,
    input.finalStatusKey ? config.getItemOrThrow(LIST_KEYS.finalStatus, input.finalStatusKey) : null,
  ]);

  const effectiveTypeRdvId = typeRdv?.id ?? existing.typeRdvId;
  if (effectiveTypeRdvId) {
    const behavior = await config.getBehaviorById(effectiveTypeRdvId);
    const effectiveAdresse = input.adresse ?? existing.adresse;
    if (behavior.requiresAddress && !effectiveAdresse) {
      throw BadRequest("Une adresse est requise pour ce type de rendez-vous");
    }
  }

  const client = await db.client.update({
    where: { id },
    data: {
      firstName: input.firstName ?? existing.firstName,
      lastName: input.lastName ?? existing.lastName,
      dossierStatusId: dossierStatus?.id ?? existing.dossierStatusId,
      agentId: input.agentId ?? existing.agentId,
      phoneNumber: input.phoneNumber ?? existing.phoneNumber,
      email: input.email ?? existing.email,
      countryId: country?.id ?? existing.countryId,
      civiliteId: civilite?.id ?? existing.civiliteId,
      maritalStatusId: maritalStatus?.id ?? existing.maritalStatusId,
      birthDate: input.birthDate ?? existing.birthDate,
      childrenId: children?.id ?? existing.childrenId,
      typeRdvId: typeRdv?.id ?? existing.typeRdvId,
      adresse: input.adresse ?? existing.adresse,
      comment: input.comment ?? existing.comment,
      finalStatusId: finalStatus?.id ?? existing.finalStatusId,
      adminNote: input.adminNote ?? existing.adminNote,
    },
    include: CLIENT_DETAIL_INCLUDE,
  });

  await recordAuditLog(db, { userId: user.id, action: AuditAction.CLIENT_UPDATED, entity: "Client", entityId: id });

  return stripAdminNote(client, user);
}

export async function deleteClient(db: ScopedPrismaClient, user: AuthenticatedUser, id: string) {
  const existing = await db.client.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw NotFound("Dossier introuvable");
  await db.client.delete({ where: { id } });
  await recordAuditLog(db, { userId: user.id, action: AuditAction.CLIENT_DELETED, entity: "Client", entityId: id });
}
