import { z } from "zod";

export const createCalendarSchema = z.object({
  name: z.string().min(1),
  color: z.string().min(1),
  isVisible: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  timezone: z.string().optional(),
  description: z.string().optional(),
});
export type CreateCalendarInput = z.infer<typeof createCalendarSchema>;

export const updateCalendarSchema = createCalendarSchema.partial();
export type UpdateCalendarInput = z.infer<typeof updateCalendarSchema>;

export const createEventCategorySchema = z.object({
  name: z.string().min(1),
  color: z.string().min(1),
  borderColor: z.string().min(1),
  textColor: z.string().optional(),
  icon: z.string().optional(),
});
export type CreateEventCategoryInput = z.infer<typeof createEventCategorySchema>;

export const updateEventCategorySchema = createEventCategorySchema.partial();
export type UpdateEventCategoryInput = z.infer<typeof updateEventCategorySchema>;

const eventTypeEnum = z.enum(["APPOINTMENT", "MEETING", "PERSONAL", "BLOCKED_TIME", "REMINDER_EVENT"]);
const availabilityEnum = z.enum(["FREE", "TENTATIVE", "BUSY", "OUT_OF_OFFICE"]);
const priorityEnum = z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]);
const appointmentStatusEnum = z.enum(["EN_ATTENTE_DE_CONFIRMATION", "CONFIRME", "ANNULE", "REFUSE"]);

export const createEventSchema = z
  .object({
    calendarId: z.string().min(1),
    title: z.string().min(1),
    description: z.string().optional(),
    location: z.string().optional(),
    startAt: z.coerce.date(),
    endAt: z.coerce.date(),
    timezone: z.string().optional(),
    isAllDay: z.boolean().optional(),
    type: eventTypeEnum,
    availability: availabilityEnum.optional(),
    priority: priorityEnum.optional(),
    recurrenceRule: z.string().optional(),
    isPrivate: z.boolean().optional(),
    categoryId: z.string().optional(),
    tags: z.array(z.string()).optional(),
    callId: z.string().optional(),
    clientId: z.string().optional(),
    // pertinents uniquement si type = APPOINTMENT
    agentRdvId: z.string().optional(),
    callNotesSnapshot: z.string().optional(),
    agentComment: z.string().optional(),
  })
  .refine((data) => data.endAt > data.startAt, { message: "endAt doit être après startAt", path: ["endAt"] });
export type CreateEventInput = z.infer<typeof createEventSchema>;

export const updateEventSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  startAt: z.coerce.date().optional(),
  endAt: z.coerce.date().optional(),
  isAllDay: z.boolean().optional(),
  /**
   * Le type était figé à la création (aucun champ ici avant ce lot) — vérifié
   * auprès de l'équipe : c'était un oubli de simplification, pas une règle du
   * cahier des charges. Changer de type vers/depuis "RDV" a des implications
   * réelles (callId requis, invariants §P0.5) — gérées dans le service, pas
   * seulement acceptées ici sans validation.
   */
  type: eventTypeEnum.optional(),
  availability: availabilityEnum.optional(),
  priority: priorityEnum.optional(),
  isPrivate: z.boolean().optional(),
  // nullable distinct d'absent : absent = inchangé, null = retirer la catégorie
  // (sous-lot C1 — sans cette distinction, "Aucune" dans le sélecteur ne pourrait
  // jamais désassigner une catégorie déjà posée sur l'événement).
  categoryId: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  // Pertinents seulement quand le type (nouveau ou déjà existant) est APPOINTMENT.
  callId: z.string().optional(),
  clientId: z.string().optional(),
  agentRdvId: z.string().optional(),
  agentComment: z.string().optional(),
});
export type UpdateEventInput = z.infer<typeof updateEventSchema>;

export const changeAppointmentStatusSchema = z.object({
  status: appointmentStatusEnum,
  comment: z.string().optional(),
});
export type ChangeAppointmentStatusInput = z.infer<typeof changeAppointmentStatusSchema>;

const attendeeRoleEnum = z.enum(["REQUIRED", "OPTIONAL", "ORGANIZER"]);
const attendeeStatusEnum = z.enum(["PENDING", "ACCEPTED", "DECLINED", "TENTATIVE", "DELEGATED"]);

/**
 * §4.13 / §P1.1 — un seul champ email pour interne ET externe : `GET /users` ne
 * permet de lister que par rôle/statut actif (pas de recherche par nom, voir
 * modules/users/schema.ts::listUsersQuerySchema), donc un sélecteur "utilisateur
 * interne" par nom se heurterait au même gap que le sélecteur d'agent RDV. Le
 * service résout côté serveur si l'email correspond à un compte existant.
 */
export const addAttendeeSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  role: attendeeRoleEnum.optional().default("REQUIRED"),
});
export type AddAttendeeInput = z.infer<typeof addAttendeeSchema>;

export const updateAttendeeStatusSchema = z.object({
  status: attendeeStatusEnum,
  comment: z.string().optional(),
});
export type UpdateAttendeeStatusInput = z.infer<typeof updateAttendeeStatusSchema>;

/**
 * Point 5 des retours de test — §P1.1 prévoit un compteur agrégé disponible/occupé
 * au moment d'assigner un agent RDV sur un créneau, PAS une vue complète de son
 * agenda (confidentialité de ses événements personnels/privés). Décision actée
 * avec l'utilisateur : ce compteur n'existait nulle part avant ce lot.
 */
export const agentAvailabilityQuerySchema = z.object({
  agentRdvId: z.string().min(1),
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
  // En édition, exclut l'événement lui-même — sinon un RDV existant se compterait
  // toujours comme "occupé" sur son propre créneau.
  excludeEventId: z.string().optional(),
});
export type AgentAvailabilityQuery = z.infer<typeof agentAvailabilityQuerySchema>;

/**
 * Sous-lot C3 — pas de SMS dans l'enum ReminderMethod (déjà retiré au niveau
 * schéma lors de la phase d'architecture) : rien à filtrer ici, l'UI ne peut pas
 * proposer une valeur qui n'existe pas dans ce z.enum.
 */
const reminderMethodEnum = z.enum(["POPUP", "EMAIL", "SOUND"]);

export const createEventReminderSchema = z.object({
  // Borné à 1 semaine : au-delà, un rappel "avant le début" perd son sens pratique
  // et complique inutilement la fenêtre de scan du job (voir jobs/eventReminders.ts).
  minutesBefore: z.number().int().min(1).max(10080),
  method: reminderMethodEnum,
});
export type CreateEventReminderInput = z.infer<typeof createEventReminderSchema>;

export const listEventsQuerySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  calendarId: z.string().optional(),
  type: eventTypeEnum.optional(),
});
export type ListEventsQuery = z.infer<typeof listEventsQuerySchema>;

/**
 * Sous-lot C4 — heures de travail en override ponctuel de l'appel (ne persiste
 * rien) ; si absentes, le service lit le `Setting` `calendar.workingHours` de
 * l'utilisateur (clé/valeur générique déjà existante, réutilisée ici plutôt que
 * d'ajouter un champ de schéma dédié), avec repli sur 8h-18h.
 */
export const suggestSlotsQuerySchema = z
  .object({
    durationMinutes: z.coerce.number().int().min(1).max(1440),
    preferredDate: z.coerce.date(),
    calendarId: z.string().optional(),
    workStartHour: z.coerce.number().int().min(0).max(23).optional(),
    workEndHour: z.coerce.number().int().min(0).max(23).optional(),
  })
  .refine((d) => d.workStartHour === undefined || d.workEndHour === undefined || d.workEndHour > d.workStartHour, {
    message: "workEndHour doit être après workStartHour",
    path: ["workEndHour"],
  });
export type SuggestSlotsQuery = z.infer<typeof suggestSlotsQuerySchema>;
