import type { ScopedPrismaClient } from "../../db/scopedClient.js";
import { Prisma } from "../../generated/prisma/client.js";
import { recordAuditLog } from "../../lib/auditLog.js";
import { syncEventConflicts } from "../../lib/conflictDetection.js";
import { AuditAction, type NotificationType } from "../../generated/prisma/enums.js";
import { createNotification } from "../../lib/notifications.js";
import { expandRecurrence } from "../../lib/rrule.js";
import { BadRequest, Conflict, Forbidden, NotFound } from "../../lib/httpError.js";
import { enqueueEmail } from "../emails/service.js";
import type { AuthenticatedUser } from "../../types/express.js";
import type {
  AddAttendeeInput,
  ChangeAppointmentStatusInput,
  CreateCalendarInput,
  CreateEventCategoryInput,
  CreateEventInput,
  CreateEventReminderInput,
  ListEventsQuery,
  UpdateAttendeeStatusInput,
  UpdateCalendarInput,
  UpdateEventCategoryInput,
  UpdateEventInput,
} from "./schema.js";

const ACTIVE_APPOINTMENT_STATUSES = ["EN_ATTENTE_DE_CONFIRMATION", "CONFIRME"] as const;

// =========================================================================
// Calendriers
// =========================================================================

/**
 * Bug réel observé en prod locale : `Calendar_userId_name_key` (unique sur
 * userId+name) peut être violé en pratique — le frontend appelle ce endpoint pour
 * "s'assurer que mon calendrier personnel existe" (aucun n'est auto-provisionné à
 * la création d'un utilisateur, voir CalendarProPage::ensureCalendar), et deux
 * appels concurrents (effet React qui se déclenche deux fois en dev, ou deux
 * onglets/sessions du même utilisateur) peuvent tous les deux voir "aucun
 * calendrier" puis tenter de le créer en même temps. Sans ce catch, le perdant de
 * la course recevait un 500 générique avec la stack Prisma brute (voir
 * middleware/errorHandler.ts — tout ce qui n'est pas un HttpError/ZodError tombe
 * en 500 nu). Traduit ici en 409 propre ; le frontend gère déjà la redondance côté
 * client (voir ensureCalendar), ceci est la contrepartie serveur pour toute autre
 * requête concurrente (autre onglet, autre appareil) que le client ne peut pas voir.
 */
export async function createCalendar(db: ScopedPrismaClient, user: AuthenticatedUser, input: CreateCalendarInput) {
  try {
    return await db.calendar.create({
      data: {
        organizationId: user.organizationId,
        userId: user.id,
        name: input.name,
        color: input.color,
        isVisible: input.isVisible ?? true,
        isDefault: input.isDefault ?? false,
        timezone: input.timezone ?? "Europe/Paris",
        description: input.description ?? null,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw Conflict("Un calendrier porte déjà ce nom");
    }
    throw error;
  }
}

export async function listCalendars(db: ScopedPrismaClient, user: AuthenticatedUser) {
  const canViewAll = user.permissions.includes("calendar.viewAll");
  return db.calendar.findMany({
    where: canViewAll ? {} : { OR: [{ userId: user.id }, { isGlobal: true }] },
    orderBy: { createdAt: "asc" },
  });
}

export async function updateCalendar(
  db: ScopedPrismaClient,
  user: AuthenticatedUser,
  id: string,
  input: UpdateCalendarInput,
) {
  const existing = await db.calendar.findUnique({ where: { id } });
  if (!existing) throw NotFound("Calendrier introuvable");
  if (existing.userId !== user.id && !user.permissions.includes("calendar.viewAll")) throw Forbidden();

  return db.calendar.update({
    where: { id },
    data: {
      name: input.name ?? existing.name,
      color: input.color ?? existing.color,
      isVisible: input.isVisible ?? existing.isVisible,
      isDefault: input.isDefault ?? existing.isDefault,
      timezone: input.timezone ?? existing.timezone,
      description: input.description ?? existing.description,
    },
  });
}

// =========================================================================
// Catégories d'événements — personnelles, comme Calendar (pas de partage
// organisationnel : chaque utilisateur gère et voit uniquement ses propres
// catégories, cohérent avec le modèle §4 : userId + unique([userId, name])).
// =========================================================================

export async function listEventCategories(db: ScopedPrismaClient, user: AuthenticatedUser) {
  return db.eventCategory.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
}

export async function createEventCategory(
  db: ScopedPrismaClient,
  user: AuthenticatedUser,
  input: CreateEventCategoryInput,
) {
  try {
    return await db.eventCategory.create({
      data: {
        organizationId: user.organizationId,
        userId: user.id,
        name: input.name,
        color: input.color,
        borderColor: input.borderColor,
        textColor: input.textColor ?? "#FFFFFF",
        icon: input.icon ?? null,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw Conflict("Une catégorie porte déjà ce nom");
    }
    throw error;
  }
}

export async function updateEventCategory(
  db: ScopedPrismaClient,
  user: AuthenticatedUser,
  id: string,
  input: UpdateEventCategoryInput,
) {
  const existing = await db.eventCategory.findUnique({ where: { id } });
  if (!existing) throw NotFound("Catégorie introuvable");
  if (existing.userId !== user.id) throw Forbidden();

  try {
    return await db.eventCategory.update({
      where: { id },
      data: {
        name: input.name ?? existing.name,
        color: input.color ?? existing.color,
        borderColor: input.borderColor ?? existing.borderColor,
        textColor: input.textColor ?? existing.textColor,
        icon: input.icon ?? existing.icon,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw Conflict("Une catégorie porte déjà ce nom");
    }
    throw error;
  }
}

/**
 * Le schéma ne déclare pas `onDelete: SetNull` sur `CalendarEvent.category` — sans
 * ce détachement manuel, supprimer une catégorie encore utilisée par un événement
 * échouerait sur la contrainte de clé étrangère (500 brut) plutôt que de simplement
 * retirer le tag de ses événements, comme on l'attend d'une catégorisation.
 */
export async function deleteEventCategory(db: ScopedPrismaClient, user: AuthenticatedUser, id: string) {
  const existing = await db.eventCategory.findUnique({ where: { id } });
  if (!existing) throw NotFound("Catégorie introuvable");
  if (existing.userId !== user.id) throw Forbidden();

  await db.calendarEvent.updateMany({ where: { categoryId: id }, data: { categoryId: null } });
  await db.eventCategory.delete({ where: { id } });
}

/**
 * Gap corrigé avant de brancher le sélecteur de catégorie côté front (sous-lot C1) :
 * `categoryId` était accepté tel quel par `createEvent`/`updateEvent` sans aucune
 * vérification de propriété — un ID de catégorie d'un autre utilisateur (deviné ou
 * intercepté) aurait pu être attaché à un événement, exposant son nom/couleur au
 * lecteur de l'événement via `getEvent` (qui inclut `category`). Même vérification
 * que pour `calendarId` juste au-dessus dans `createEvent`.
 */
async function assertOwnedCategory(db: ScopedPrismaClient, user: AuthenticatedUser, categoryId: string) {
  const category = await db.eventCategory.findUnique({ where: { id: categoryId } });
  if (!category || category.userId !== user.id) throw BadRequest("Catégorie invalide");
}

// =========================================================================
// Invariants métier des rendez-vous (type = APPOINTMENT uniquement)
// =========================================================================

async function assertNoActiveAppointmentForCall(db: ScopedPrismaClient, callId: string, excludeEventId?: string) {
  const active = await db.calendarEvent.findFirst({
    where: {
      callId,
      type: "APPOINTMENT",
      status: { in: [...ACTIVE_APPOINTMENT_STATUSES] },
      ...(excludeEventId ? { id: { not: excludeEventId } } : {}),
    },
  });
  if (active) throw Conflict("Un rendez-vous actif existe déjà pour cet appel");
}

async function assertNoAgentOverlap(
  db: ScopedPrismaClient,
  agentRdvId: string,
  startAt: Date,
  endAt: Date,
  excludeEventId?: string,
) {
  const overlapping = await db.calendarEvent.findFirst({
    where: {
      agentRdvId,
      type: "APPOINTMENT",
      status: { in: [...ACTIVE_APPOINTMENT_STATUSES] },
      startAt: { lt: endAt },
      endAt: { gt: startAt },
      ...(excludeEventId ? { id: { not: excludeEventId } } : {}),
    },
  });
  if (overlapping) throw Conflict("Cet agent RDV a déjà un rendez-vous actif sur ce créneau");
}

/**
 * Point 5 des retours de test — §P1.1 : compteur agrégé disponible/occupé au
 * moment d'assigner un agent RDV sur un créneau, décidé explicitement avec
 * l'utilisateur plutôt qu'une vue complète de son agenda (confidentialité de ses
 * événements personnels/privés — voir `eventAccessFilter`/`isPrivate` ailleurs
 * dans ce fichier). Volontairement SANS `eventAccessFilter` : c'est le même calcul
 * que `assertNoAgentOverlap`, cross-agent par construction, mais ne renvoie qu'un
 * nombre, jamais le contenu des événements concurrents.
 */
export async function getAgentAvailability(
  db: ScopedPrismaClient,
  agentRdvId: string,
  startAt: Date,
  endAt: Date,
  excludeEventId?: string,
) {
  const busyCount = await db.calendarEvent.count({
    where: {
      agentRdvId,
      type: "APPOINTMENT",
      status: { in: [...ACTIVE_APPOINTMENT_STATUSES] },
      startAt: { lt: endAt },
      endAt: { gt: startAt },
      ...(excludeEventId ? { id: { not: excludeEventId } } : {}),
    },
  });
  return { busyCount };
}

/**
 * Point 4 des retours de test — un événement ne peut pas être créé/déplacé dans le
 * passé (vérifié ici, pas seulement côté client). Deux nuances volontaires :
 *  - Journée entière (`isAllDay`) : comparaison sur la DATE seule (minuit local),
 *    pas l'heure exacte — sinon un événement "aujourd'hui" créé l'après-midi serait
 *    rejeté à tort alors que la journée n'est pas terminée.
 *  - S'applique à `startAt` de la SÉRIE pour un événement récurrent — les
 *    occurrences futures ne sont jamais des lignes distinctes tant qu'elles ne sont
 *    pas éditées individuellement (fonctionnalité pas encore construite), donc rien
 *    de plus à valider pour la récurrence à ce stade.
 *  - S'applique à tous les types d'événement (pas seulement RDV) : rien dans la
 *    demande ne distingue BLOCKED_TIME/PERSONAL, donc pas d'exception ajoutée sans
 *    demande explicite.
 */
function assertNotInPast(startAt: Date, isAllDay: boolean) {
  const now = new Date();
  if (isAllDay) {
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startMidnight = new Date(startAt.getFullYear(), startAt.getMonth(), startAt.getDate());
    if (startMidnight < todayMidnight) throw BadRequest("Un événement ne peut pas être créé dans le passé");
    return;
  }
  if (startAt < now) throw BadRequest("Un événement ne peut pas être créé dans le passé");
}

// =========================================================================
// Événements
// =========================================================================

export async function createEvent(db: ScopedPrismaClient, user: AuthenticatedUser, input: CreateEventInput) {
  const calendar = await db.calendar.findUnique({ where: { id: input.calendarId } });
  if (!calendar) throw NotFound("Calendrier introuvable");
  if (input.categoryId) await assertOwnedCategory(db, user, input.categoryId);
  assertNotInPast(input.startAt, input.isAllDay ?? false);

  const isAppointment = input.type === "APPOINTMENT";
  if (isAppointment) {
    if (!input.callId) throw BadRequest("Un rendez-vous doit être rattaché à un appel");
    await assertNoActiveAppointmentForCall(db, input.callId);
    if (input.agentRdvId) {
      await assertNoAgentOverlap(db, input.agentRdvId, input.startAt, input.endAt);
    }
  }

  const event = await db.calendarEvent.create({
    data: {
      organizationId: user.organizationId,
      calendarId: input.calendarId,
      title: input.title,
      description: input.description ?? null,
      location: input.location ?? null,
      startAt: input.startAt,
      endAt: input.endAt,
      timezone: input.timezone ?? calendar.timezone,
      isAllDay: input.isAllDay ?? false,
      type: input.type,
      availability: input.availability ?? "BUSY",
      priority: input.priority ?? "NORMAL",
      recurrenceRule: input.recurrenceRule ?? null,
      isRecurring: Boolean(input.recurrenceRule),
      isPrivate: input.isPrivate ?? false,
      categoryId: input.categoryId ?? null,
      tags: input.tags ?? [],
      organizerId: user.id,
      callId: input.callId ?? null,
      clientId: input.clientId ?? null,
      agentRdvId: isAppointment ? (input.agentRdvId ?? null) : null,
      status: isAppointment ? "EN_ATTENTE_DE_CONFIRMATION" : null,
      callNotesSnapshot: isAppointment ? (input.callNotesSnapshot ?? null) : null,
      agentComment: isAppointment ? (input.agentComment ?? null) : null,
    },
  });

  await syncEventConflicts(db, event);

  if (isAppointment) {
    await db.calendarEventStatusHistory.create({
      data: { eventId: event.id, newStatus: "EN_ATTENTE_DE_CONFIRMATION", changedById: user.id },
    });
    if (event.agentRdvId) {
      await createNotification(db, {
        organizationId: user.organizationId,
        userId: event.agentRdvId,
        type: "APPOINTMENT_ASSIGNED",
        title: `Nouveau rendez-vous : ${event.title}`,
        meta: { eventId: event.id },
      });
    }
  }

  await recordAuditLog(db, { userId: user.id, action: AuditAction.EVENT_CREATED, entity: "CalendarEvent", entityId: event.id });

  // Confirmation automatique à la création du RDV (décision #2 — les deux seuls cas
  // réellement automatisés, avec le rappel la veille géré par jobs/emailQueueProcessor.ts).
  if (isAppointment && event.clientId) {
    await enqueueEmail(db, user.organizationId, {
      clientId: event.clientId,
      templateKey: "confirmation_rdv",
      appointmentEventId: event.id,
      scheduledAt: new Date(),
      createdById: user.id,
    });
  }

  return event;
}

/**
 * Portée par utilisateur — gap trouvé et corrigé au sous-lot A du calendrier
 * (Calendrier Pro, §5.14) : cette fonction acceptait déjà `user` en paramètre mais
 * ne l'utilisait jamais (`_user`, préfixe underscore = signal qu'il était mort).
 * Résultat réel avant ce correctif : n'importe quel utilisateur avec `calendar.view`
 * seul (Agent calliste, Agent RDV — voir lib/defaultRoles.ts, aucun des deux n'a
 * `calendar.viewAll`) recevait TOUS les événements de TOUTE l'organisation sur
 * `GET /calendar-events`, y compris les entrées personnelles d'un autre agent —
 * `calendar.viewAll` et `CalendarEvent.isPrivate` existent bien dans le schéma mais
 * n'étaient consommés nulle part. Sans cette portée, la grille du sous-lot A
 * afficherait le calendrier de tout le monde à tout le monde.
 */
function eventAccessFilter(user: AuthenticatedUser) {
  const canViewAll = user.permissions.includes("calendar.viewAll");
  if (canViewAll) return {};

  return {
    AND: [
      {
        OR: [
          { organizerId: user.id },
          { agentRdvId: user.id },
          { calendar: { OR: [{ userId: user.id }, { isGlobal: true }] } },
          { attendees: { some: { userId: user.id } } },
        ],
      },
      { OR: [{ isPrivate: false }, { organizerId: user.id }, { agentRdvId: user.id }] },
    ],
  };
}

/** Fenêtre [from, to] : mélange événements simples, occurrences virtuelles récurrentes et occurrences modifiées. */
export async function listEvents(db: ScopedPrismaClient, user: AuthenticatedUser, query: ListEventsQuery) {
  const calendarFilter = query.calendarId ? { calendarId: query.calendarId } : {};
  const typeFilter = query.type ? { type: query.type } : {};
  const accessFilter = eventAccessFilter(user);

  // Point 3 des retours de test — indicateur "invitation en attente de réponse"
  // sur la grille : on ne remonte qu'un booléen dérivé, pas la liste des
  // participants (jointure filtrée sur l'utilisateur courant, coût négligeable).
  const pendingInvitationInclude = {
    attendees: { where: { userId: user.id, status: "PENDING" as const }, select: { id: true } },
  };

  const [plainEvents, recurringParents, modifiedOccurrences] = await Promise.all([
    db.calendarEvent.findMany({
      where: {
        ...calendarFilter,
        ...typeFilter,
        ...accessFilter,
        isRecurring: false,
        recurrenceId: null,
        startAt: { lt: query.to },
        endAt: { gt: query.from },
      },
      include: pendingInvitationInclude,
    }),
    db.calendarEvent.findMany({
      where: { ...calendarFilter, ...typeFilter, ...accessFilter, isRecurring: true, recurrenceId: null },
      include: pendingInvitationInclude,
    }),
    db.calendarEvent.findMany({
      where: {
        ...calendarFilter,
        ...typeFilter,
        ...accessFilter,
        recurrenceId: { not: null },
        startAt: { lt: query.to },
        endAt: { gt: query.from },
      },
      include: pendingInvitationInclude,
    }),
  ]);

  function withPendingFlag<T extends { attendees: { id: string }[] }>(event: T) {
    const { attendees, ...rest } = event;
    return { ...rest, hasPendingInvitation: attendees.length > 0 };
  }

  const virtualOccurrences = recurringParents.flatMap((parent) => {
    if (!parent.recurrenceRule) return [];
    const occurrences = expandRecurrence(
      { startAt: parent.startAt, endAt: parent.endAt, recurrenceRule: parent.recurrenceRule, exceptionDates: parent.exceptionDates },
      query.from,
      query.to,
    );
    const parentWithFlag = withPendingFlag(parent);
    return occurrences.map((occurrence) => ({
      ...parentWithFlag,
      id: `${parent.id}::${occurrence.start.toISOString()}`,
      sourceEventId: parent.id,
      isVirtualOccurrence: true as const,
      startAt: occurrence.start,
      endAt: occurrence.end,
    }));
  });

  return [...plainEvents.map(withPendingFlag), ...modifiedOccurrences.map(withPendingFlag), ...virtualOccurrences].sort(
    (a, b) => a.startAt.getTime() - b.startAt.getTime(),
  );
}

/**
 * Même famille de gap que `listEvents` (voir `eventAccessFilter` ci-dessus) :
 * `getEvent` n'acceptait même pas `user` en paramètre — n'importe quel utilisateur
 * authentifié avec `calendar.view` pouvait lire N'IMPORTE QUEL événement de
 * l'organisation par ID deviné/énuméré, y compris un événement privé d'un autre
 * agent. Et `updateEvent`/`deleteEvent`/`changeAppointmentStatus` n'avaient AUCUNE
 * vérification de propriété : n'importe qui avec `calendar.update`/`calendar.delete`/
 * `calendar.manageAppointments` pouvait modifier, annuler ou supprimer le rendez-vous
 * de n'importe quel autre agent. Corrigé avant de connecter ces routes au frontend
 * (sous-lot A) — écrire une UI par-dessus des endpoints d'écriture non scopés aurait
 * rendu le problème exploitable en un clic, pas juste en théorie.
 */
function canReadEvent(
  user: AuthenticatedUser,
  event: {
    organizerId: string;
    agentRdvId: string | null;
    isPrivate: boolean;
    calendar: { userId: string; isGlobal: boolean };
    attendees: { userId: string | null }[];
  },
): boolean {
  if (user.permissions.includes("calendar.viewAll")) return true;
  const isInvolved =
    event.organizerId === user.id ||
    event.agentRdvId === user.id ||
    event.calendar.userId === user.id ||
    event.calendar.isGlobal ||
    event.attendees.some((a) => a.userId === user.id);
  if (!isInvolved) return false;
  if (event.isPrivate && event.organizerId !== user.id && event.agentRdvId !== user.id) return false;
  return true;
}

function assertCanWriteEvent(user: AuthenticatedUser, event: { organizerId: string; agentRdvId: string | null }): void {
  if (user.permissions.includes("calendar.viewAll")) return;
  if (event.organizerId === user.id || event.agentRdvId === user.id) return;
  throw Forbidden("Vous ne pouvez pas modifier cet événement");
}

export async function getEvent(db: ScopedPrismaClient, user: AuthenticatedUser, id: string) {
  const event = await db.calendarEvent.findUnique({
    where: { id },
    include: {
      calendar: true,
      category: true,
      attendees: true,
      reminders: true,
      statusHistory: { orderBy: { changedAt: "desc" }, include: { changedBy: { select: { id: true, firstName: true, lastName: true } } } },
      conflictsA: true,
    },
  });
  if (!event) throw NotFound("Événement introuvable");
  if (!canReadEvent(user, event)) throw Forbidden("Vous ne pouvez pas voir cet événement");
  return event;
}

export async function updateEvent(db: ScopedPrismaClient, user: AuthenticatedUser, id: string, input: UpdateEventInput) {
  const existing = await db.calendarEvent.findUnique({ where: { id } });
  if (!existing) throw NotFound("Événement introuvable");
  assertCanWriteEvent(user, existing);
  if (input.categoryId) await assertOwnedCategory(db, user, input.categoryId);
  // Point 4 : seulement si `startAt` change réellement — modifier un événement déjà
  // passé sans toucher sa date (ex. ajouter une note) reste permis.
  if (input.startAt !== undefined) {
    assertNotInPast(input.startAt, input.isAllDay ?? existing.isAllDay);
  }

  const nextStartAt = input.startAt ?? existing.startAt;
  const nextEndAt = input.endAt ?? existing.endAt;
  const nextType = input.type ?? existing.type;
  const becomingAppointment = nextType === "APPOINTMENT" && existing.type !== "APPOINTMENT";
  const leavingAppointment = existing.type === "APPOINTMENT" && nextType !== "APPOINTMENT";
  const nextAgentRdvId = input.agentRdvId ?? existing.agentRdvId;

  let nextCallId = existing.callId;
  let nextClientId = existing.clientId;
  let nextStatus = existing.status;

  if (becomingAppointment) {
    // Même règle qu'à la création (createEvent) : un RDV doit être rattaché à un appel.
    nextCallId = input.callId ?? existing.callId;
    if (!nextCallId) throw BadRequest("Un rendez-vous doit être rattaché à un appel");
    nextClientId = input.clientId ?? existing.clientId;
    await assertNoActiveAppointmentForCall(db, nextCallId, id);
    if (nextAgentRdvId) await assertNoAgentOverlap(db, nextAgentRdvId, nextStartAt, nextEndAt, id);
    nextStatus = "EN_ATTENTE_DE_CONFIRMATION";
  } else if (leavingAppointment) {
    // §4 : agentRdvId/status "pertinents seulement si type = APPOINTMENT" — on les
    // efface pour ne pas laisser un statut de RDV périmé sur un événement qui n'en
    // est plus un. callId/clientId restent (champs génériques, pas exclusifs au RDV).
    nextStatus = null;
  } else if (existing.type === "APPOINTMENT" && nextAgentRdvId) {
    await assertNoAgentOverlap(db, nextAgentRdvId, nextStartAt, nextEndAt, id);
  }

  const event = await db.calendarEvent.update({
    where: { id },
    data: {
      title: input.title ?? existing.title,
      description: input.description ?? existing.description,
      location: input.location ?? existing.location,
      startAt: nextStartAt,
      endAt: nextEndAt,
      isAllDay: input.isAllDay ?? existing.isAllDay,
      type: nextType,
      availability: input.availability ?? existing.availability,
      priority: input.priority ?? existing.priority,
      isPrivate: input.isPrivate ?? existing.isPrivate,
      categoryId: input.categoryId === undefined ? existing.categoryId : input.categoryId,
      tags: input.tags ?? existing.tags,
      callId: nextCallId,
      clientId: nextClientId,
      agentRdvId: leavingAppointment ? null : nextType === "APPOINTMENT" ? nextAgentRdvId : existing.agentRdvId,
      status: nextStatus,
      agentComment: input.agentComment ?? existing.agentComment,
    },
  });

  await syncEventConflicts(db, event);

  if (becomingAppointment) {
    await db.calendarEventStatusHistory.create({
      data: { eventId: event.id, newStatus: "EN_ATTENTE_DE_CONFIRMATION", changedById: user.id },
    });
    if (event.agentRdvId) {
      await createNotification(db, {
        organizationId: user.organizationId,
        userId: event.agentRdvId,
        type: "APPOINTMENT_ASSIGNED",
        title: `Nouveau rendez-vous : ${event.title}`,
        meta: { eventId: event.id },
      });
    }
  }

  await recordAuditLog(db, { userId: user.id, action: AuditAction.EVENT_UPDATED, entity: "CalendarEvent", entityId: id });

  return event;
}

export async function changeAppointmentStatus(
  db: ScopedPrismaClient,
  user: AuthenticatedUser,
  id: string,
  input: ChangeAppointmentStatusInput,
) {
  const existing = await db.calendarEvent.findUnique({ where: { id } });
  if (!existing) throw NotFound("Événement introuvable");
  if (existing.type !== "APPOINTMENT") throw BadRequest("Ce statut ne s'applique qu'aux rendez-vous");
  assertCanWriteEvent(user, existing);

  if (input.status === "CONFIRME") {
    await assertNoActiveAppointmentForCall(db, existing.callId ?? "", id);
    if (existing.agentRdvId) {
      await assertNoAgentOverlap(db, existing.agentRdvId, existing.startAt, existing.endAt, id);
    }
  }

  const [event] = await db.$transaction([
    db.calendarEvent.update({ where: { id }, data: { status: input.status } }),
    db.calendarEventStatusHistory.create({
      data: {
        eventId: id,
        oldStatus: existing.status,
        newStatus: input.status,
        changedById: user.id,
        comment: input.comment ?? null,
      },
    }),
  ]);

  await recordAuditLog(db, {
    userId: user.id,
    action: AuditAction.APPOINTMENT_STATUS_CHANGED,
    entity: "CalendarEvent",
    entityId: id,
    meta: { status: input.status },
  });

  const notificationByStatus: Partial<Record<typeof input.status, NotificationType>> = {
    CONFIRME: "APPOINTMENT_CONFIRMED",
    REFUSE: "APPOINTMENT_REFUSED",
    ANNULE: "APPOINTMENT_UPDATED",
  };
  const notificationType = notificationByStatus[input.status];
  if (notificationType && existing.organizerId !== user.id) {
    await createNotification(db, {
      organizationId: user.organizationId,
      userId: existing.organizerId,
      type: notificationType,
      title: `Rendez-vous "${existing.title}" : ${input.status.toLowerCase().replaceAll("_", " ")}`,
      meta: { eventId: id },
    });
  }

  return event;
}

export async function deleteEvent(db: ScopedPrismaClient, user: AuthenticatedUser, id: string) {
  const existing = await db.calendarEvent.findUnique({ where: { id }, select: { id: true, organizerId: true, agentRdvId: true } });
  if (!existing) throw NotFound("Événement introuvable");
  assertCanWriteEvent(user, existing);
  await db.calendarEvent.delete({ where: { id } });
  await recordAuditLog(db, { userId: user.id, action: AuditAction.EVENT_DELETED, entity: "CalendarEvent", entityId: id });
}

// =========================================================================
// Participants (EventAttendee, sous-lot C2) — un seul champ email couvre
// interne (résolu vers un compte existant de l'organisation) et externe (aucun
// compte, `userId` reste null). Gérer la liste (ajouter/retirer) est un acte
// d'écriture sur l'événement (même gate que updateEvent) ; répondre à sa PROPRE
// invitation (accepter/décliner) est une autorisation distincte, ouverte à tout
// participant interne même s'il n'est ni organisateur ni agent RDV.
// =========================================================================

async function loadEventForAttendeeManagement(db: ScopedPrismaClient, user: AuthenticatedUser, eventId: string) {
  const event = await db.calendarEvent.findUnique({ where: { id: eventId } });
  if (!event) throw NotFound("Événement introuvable");
  assertCanWriteEvent(user, event);
  return event;
}

export async function addAttendee(
  db: ScopedPrismaClient,
  user: AuthenticatedUser,
  eventId: string,
  input: AddAttendeeInput,
) {
  const event = await loadEventForAttendeeManagement(db, user, eventId);
  const email = input.email.trim().toLowerCase();

  const matchedUser = await db.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
  /**
   * Bug corrigé : la résolution interne/externe (via `userId` ci-dessous) s'est
   * toujours basée uniquement sur l'email — jamais sur `input.name` — mais le
   * `name` STOCKÉ reprenait tel quel la saisie de l'appelant même quand l'email
   * correspondait à un compte existant (ex. email correct + "camille" saisi dans
   * le champ nom au lieu de "Camille Calliste"). Un nom affiché différent du vrai
   * nom du compte donnait l'impression trompeuse d'un participant externe alors
   * que `userId` était en réalité bien résolu. Le nom saisi n'a de sens que pour
   * un externe (qui n'a pas de compte dont tirer un nom) ; pour un interne, il est
   * désormais ignoré et remplacé par le nom réel du compte.
   */
  const resolvedName = matchedUser
    ? `${matchedUser.firstName ?? ""} ${matchedUser.lastName ?? ""}`.trim() || null
    : (input.name ?? null);

  let attendee;
  try {
    attendee = await db.eventAttendee.create({
      data: {
        eventId: event.id,
        userId: matchedUser?.id ?? null,
        email,
        name: resolvedName,
        role: input.role ?? "REQUIRED",
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw Conflict("Cette personne est déjà invitée à cet événement");
    }
    throw error;
  }

  // §C2 point 2 : notification uniquement pour un participant interne (un externe
  // n'a pas de compte pour la recevoir) — jamais quand on s'ajoute soi-même.
  if (matchedUser && matchedUser.id !== user.id) {
    await createNotification(db, {
      organizationId: user.organizationId,
      userId: matchedUser.id,
      type: "EVENT_INVITATION",
      title: `Invitation : ${event.title}`,
      body: `${new Date(event.startAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}`,
      meta: { eventId: event.id },
    });
  }

  return attendee;
}

export async function removeAttendee(db: ScopedPrismaClient, user: AuthenticatedUser, eventId: string, attendeeId: string) {
  await loadEventForAttendeeManagement(db, user, eventId);
  const attendee = await db.eventAttendee.findFirst({ where: { id: attendeeId, eventId } });
  if (!attendee) throw NotFound("Participant introuvable");
  await db.eventAttendee.delete({ where: { id: attendeeId } });
}

export async function updateAttendeeStatus(
  db: ScopedPrismaClient,
  user: AuthenticatedUser,
  eventId: string,
  attendeeId: string,
  input: UpdateAttendeeStatusInput,
) {
  const event = await db.calendarEvent.findUnique({ where: { id: eventId } });
  if (!event) throw NotFound("Événement introuvable");
  const attendee = await db.eventAttendee.findFirst({ where: { id: attendeeId, eventId } });
  if (!attendee) throw NotFound("Participant introuvable");

  const isSelf = attendee.userId === user.id;
  const canManage =
    event.organizerId === user.id || event.agentRdvId === user.id || user.permissions.includes("calendar.viewAll");
  if (!isSelf && !canManage) throw Forbidden("Vous ne pouvez répondre qu'à votre propre invitation");

  return db.eventAttendee.update({
    where: { id: attendeeId },
    data: { status: input.status, comment: input.comment ?? attendee.comment, respondedAt: new Date() },
  });
}

/**
 * Badge du rail (notifications) — exception actionnable actée avec l'utilisateur :
 * une invitation `PENDING` doit maintenir le badge quel que soit son ancienneté ou
 * la visite de /notifications, puisque visiter la liste ne "traite" pas une
 * invitation — seule une réponse (accepter/décliner) le fait. Sans filtre de date
 * volontairement : une invitation ancienne jamais traitée doit continuer à
 * compter. `db.eventAttendee.count` est déjà scopé à l'organisation via la
 * relation `event` (voir RELATION_SCOPED_MODELS dans db/scopedClient.ts).
 */
export async function countPendingInvitations(db: ScopedPrismaClient, userId: string) {
  const count = await db.eventAttendee.count({ where: { userId, status: "PENDING" } });
  return { count };
}

// =========================================================================
// Rappels (EventReminder, sous-lot C3) — décision actée avec l'utilisateur :
// un rappel concerne l'ORGANISATEUR uniquement (pas de diffusion aux
// participants ACCEPTED, pas d'agent RDV) — pas de champ `userId` sur
// EventReminder, la cible est toujours `event.organizerId`. Gate volontairement
// plus stricte que `assertCanWriteEvent` (agent RDV/`calendar.viewAll` peuvent
// éditer l'événement mais ne doivent pas voir/gérer les rappels de quelqu'un
// d'autre — ce sont des réglages personnels, pas un attribut partagé de
// l'événement). Le déclenchement effectif est géré par jobs/eventReminders.ts.
// =========================================================================

async function loadEventForReminderManagement(db: ScopedPrismaClient, user: AuthenticatedUser, eventId: string) {
  const event = await db.calendarEvent.findUnique({ where: { id: eventId } });
  if (!event) throw NotFound("Événement introuvable");
  if (event.organizerId !== user.id) throw Forbidden("Seul l'organisateur peut gérer les rappels de cet événement");
  return event;
}

export async function listReminders(db: ScopedPrismaClient, user: AuthenticatedUser, eventId: string) {
  await loadEventForReminderManagement(db, user, eventId);
  return db.eventReminder.findMany({ where: { eventId }, orderBy: { minutesBefore: "asc" } });
}

export async function createReminder(
  db: ScopedPrismaClient,
  user: AuthenticatedUser,
  eventId: string,
  input: CreateEventReminderInput,
) {
  const event = await loadEventForReminderManagement(db, user, eventId);

  const reminder = await db.eventReminder.create({
    data: { eventId: event.id, minutesBefore: input.minutesBefore, method: input.method },
  });

  /**
   * Cas limite tranché avec l'utilisateur : un événement (non récurrent) déjà
   * passé au moment de la création du rappel ne déclenche jamais d'envoi
   * rétroactif. On écrit tout de suite la ligne de dédup correspondante pour que
   * jobs/eventReminders.ts ne la considère plus jamais "due" — sans ça, la
   * condition `dueAt <= now` serait vraie dès le premier passage du job mais
   * bloquée par le second garde-fou (`occurrence.start > now`), ce qui la
   * laisserait dans un flou "ni envoyée ni marquée traitée" pour toujours.
   * Un événement récurrent n'a pas ce problème : `startAt` du modèle peut être
   * dans le passé (série ancienne toujours active) sans que ça dise rien des
   * occurrences futures, donc rien à marquer ici pour ce cas.
   */
  if (!event.isRecurring && event.startAt <= new Date()) {
    await db.eventReminderFiring.create({
      data: { reminderId: reminder.id, eventId: event.id, occurrenceStartAt: event.startAt },
    });
  }

  return reminder;
}

export async function deleteReminder(db: ScopedPrismaClient, user: AuthenticatedUser, eventId: string, reminderId: string) {
  await loadEventForReminderManagement(db, user, eventId);
  const reminder = await db.eventReminder.findFirst({ where: { id: reminderId, eventId } });
  if (!reminder) throw NotFound("Rappel introuvable");
  await db.eventReminder.delete({ where: { id: reminderId } });
}
