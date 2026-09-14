import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { requireParam } from "../../lib/params.js";
import {
  addAttendeeSchema,
  agentAvailabilityQuerySchema,
  changeAppointmentStatusSchema,
  createCalendarSchema,
  createEventCategorySchema,
  createEventReminderSchema,
  createEventSchema,
  listEventsQuerySchema,
  suggestSlotsQuerySchema,
  updateAttendeeStatusSchema,
  updateCalendarSchema,
  updateEventCategorySchema,
  updateEventSchema,
} from "./schema.js";
import * as calendarService from "./service.js";

export const calendarsRouter = Router();
calendarsRouter.use(authMiddleware, tenantMiddleware);

calendarsRouter.get("/", requirePermission("calendar.view"), async (req, res, next) => {
  try {
    res.json(await calendarService.listCalendars(req.db!, req.user!));
  } catch (error) {
    next(error);
  }
});

calendarsRouter.post("/", requirePermission("calendar.create"), async (req, res, next) => {
  try {
    const input = createCalendarSchema.parse(req.body);
    res.status(201).json(await calendarService.createCalendar(req.db!, req.user!, input));
  } catch (error) {
    next(error);
  }
});

calendarsRouter.patch("/:id", requirePermission("calendar.update"), async (req, res, next) => {
  try {
    const input = updateCalendarSchema.parse(req.body);
    res.json(await calendarService.updateCalendar(req.db!, req.user!, requireParam(req, "id"), input));
  } catch (error) {
    next(error);
  }
});

export const eventCategoriesRouter = Router();
eventCategoriesRouter.use(authMiddleware, tenantMiddleware);

eventCategoriesRouter.get("/", requirePermission("calendar.view"), async (req, res, next) => {
  try {
    res.json(await calendarService.listEventCategories(req.db!, req.user!));
  } catch (error) {
    next(error);
  }
});

eventCategoriesRouter.post("/", requirePermission("calendar.create"), async (req, res, next) => {
  try {
    const input = createEventCategorySchema.parse(req.body);
    res.status(201).json(await calendarService.createEventCategory(req.db!, req.user!, input));
  } catch (error) {
    next(error);
  }
});

eventCategoriesRouter.patch("/:id", requirePermission("calendar.update"), async (req, res, next) => {
  try {
    const input = updateEventCategorySchema.parse(req.body);
    res.json(await calendarService.updateEventCategory(req.db!, req.user!, requireParam(req, "id"), input));
  } catch (error) {
    next(error);
  }
});

eventCategoriesRouter.delete("/:id", requirePermission("calendar.delete"), async (req, res, next) => {
  try {
    await calendarService.deleteEventCategory(req.db!, req.user!, requireParam(req, "id"));
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export const calendarEventsRouter = Router();
calendarEventsRouter.use(authMiddleware, tenantMiddleware);

calendarEventsRouter.get("/", requirePermission("calendar.view"), async (req, res, next) => {
  try {
    const query = listEventsQuerySchema.parse(req.query);
    res.json(await calendarService.listEvents(req.db!, req.user!, query));
  } catch (error) {
    next(error);
  }
});

calendarEventsRouter.post("/", requirePermission("calendar.create"), async (req, res, next) => {
  try {
    const input = createEventSchema.parse(req.body);
    res.status(201).json(await calendarService.createEvent(req.db!, req.user!, input));
  } catch (error) {
    next(error);
  }
});

/**
 * Enregistré AVANT `GET /:id` ci-dessous — sinon Express matcherait
 * "agent-availability" comme valeur de `:id`. Gate `calendar.view` (pas
 * `calendar.viewAll`) : c'est un compteur agrégé, jamais le contenu des
 * événements d'autrui, donc pas besoin du droit de tout voir pour l'utiliser.
 */
calendarEventsRouter.get("/agent-availability", requirePermission("calendar.view"), async (req, res, next) => {
  try {
    const query = agentAvailabilityQuerySchema.parse(req.query);
    res.json(
      await calendarService.getAgentAvailability(
        req.db!,
        query.agentRdvId,
        query.startAt,
        query.endAt,
        query.excludeEventId,
      ),
    );
  } catch (error) {
    next(error);
  }
});

/**
 * Enregistré AVANT `GET /:id` pour la même raison qu'`agent-availability`
 * ci-dessus. Badge du rail (notifications) : nombre d'invitations `PENDING` pour
 * l'appelant lui-même, sans filtre de date — voir countPendingInvitations.
 */
calendarEventsRouter.get("/pending-invitations-count", requirePermission("calendar.view"), async (req, res, next) => {
  try {
    res.json(await calendarService.countPendingInvitations(req.db!, req.user!.id));
  } catch (error) {
    next(error);
  }
});

/**
 * Sous-lot C4 — enregistré AVANT `GET /:id` pour la même raison qu'`agent-availability`
 * et `pending-invitations-count` ci-dessus (sinon Express matcherait "suggest-slots"
 * comme valeur de `:id`). Gate `calendar.create` : sert à préparer la création d'un
 * événement, pas juste à consulter.
 */
calendarEventsRouter.get("/suggest-slots", requirePermission("calendar.create"), async (req, res, next) => {
  try {
    const query = suggestSlotsQuerySchema.parse(req.query);
    res.json(await calendarService.suggestSlots(req.db!, req.user!, query));
  } catch (error) {
    next(error);
  }
});

calendarEventsRouter.get("/:id", requirePermission("calendar.view"), async (req, res, next) => {
  try {
    res.json(await calendarService.getEvent(req.db!, req.user!, requireParam(req, "id")));
  } catch (error) {
    next(error);
  }
});

calendarEventsRouter.patch("/:id", requirePermission("calendar.update"), async (req, res, next) => {
  try {
    const input = updateEventSchema.parse(req.body);
    res.json(await calendarService.updateEvent(req.db!, req.user!, requireParam(req, "id"), input));
  } catch (error) {
    next(error);
  }
});

calendarEventsRouter.patch(
  "/:id/appointment-status",
  requirePermission("calendar.manageAppointments"),
  async (req, res, next) => {
    try {
      const input = changeAppointmentStatusSchema.parse(req.body);
      res.json(await calendarService.changeAppointmentStatus(req.db!, req.user!, requireParam(req, "id"), input));
    } catch (error) {
      next(error);
    }
  },
);

calendarEventsRouter.delete("/:id", requirePermission("calendar.delete"), async (req, res, next) => {
  try {
    await calendarService.deleteEvent(req.db!, req.user!, requireParam(req, "id"));
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

calendarEventsRouter.post("/:id/attendees", requirePermission("calendar.update"), async (req, res, next) => {
  try {
    const input = addAttendeeSchema.parse(req.body);
    res.status(201).json(await calendarService.addAttendee(req.db!, req.user!, requireParam(req, "id"), input));
  } catch (error) {
    next(error);
  }
});

calendarEventsRouter.delete("/:id/attendees/:attendeeId", requirePermission("calendar.update"), async (req, res, next) => {
  try {
    await calendarService.removeAttendee(req.db!, req.user!, requireParam(req, "id"), requireParam(req, "attendeeId"));
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

/**
 * Gate volontairement `calendar.view` (pas `calendar.update`) : répondre à sa
 * propre invitation n'a rien à voir avec le droit d'éditer l'événement — un
 * participant simple (Agent calliste, sans `calendar.update`) doit pouvoir
 * accepter/décliner sa propre invitation. L'autorisation fine (soi-même OU
 * organisateur/agent RDV) est vérifiée dans le service, pas ici.
 */
calendarEventsRouter.patch(
  "/:id/attendees/:attendeeId/status",
  requirePermission("calendar.view"),
  async (req, res, next) => {
    try {
      const input = updateAttendeeStatusSchema.parse(req.body);
      res.json(
        await calendarService.updateAttendeeStatus(
          req.db!,
          req.user!,
          requireParam(req, "id"),
          requireParam(req, "attendeeId"),
          input,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Sous-lot C3 — gate `calendar.view`/`calendar.update` au niveau route (cohérence
 * avec le reste du module), mais l'autorisation fine "organisateur uniquement"
 * (décision actée, pas de bypass agent RDV/calendar.viewAll) est vérifiée dans
 * le service, jamais ici.
 */
calendarEventsRouter.get("/:id/reminders", requirePermission("calendar.view"), async (req, res, next) => {
  try {
    res.json(await calendarService.listReminders(req.db!, req.user!, requireParam(req, "id")));
  } catch (error) {
    next(error);
  }
});

calendarEventsRouter.post("/:id/reminders", requirePermission("calendar.update"), async (req, res, next) => {
  try {
    const input = createEventReminderSchema.parse(req.body);
    res.status(201).json(await calendarService.createReminder(req.db!, req.user!, requireParam(req, "id"), input));
  } catch (error) {
    next(error);
  }
});

calendarEventsRouter.delete("/:id/reminders/:reminderId", requirePermission("calendar.update"), async (req, res, next) => {
  try {
    await calendarService.deleteReminder(req.db!, req.user!, requireParam(req, "id"), requireParam(req, "reminderId"));
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

/**
 * Sous-lot C4 — `:id` dans l'URL n'est utilisé que pour la cohérence de la route
 * (sous-ressource de l'événement) ; l'autorisation réelle (écrire sur AU MOINS UN
 * des deux événements de la paire, décision actée) est vérifiée dans le service à
 * partir du conflit lui-même, pas de `:id` seul.
 */
calendarEventsRouter.patch(
  "/:id/conflicts/:conflictId/resolve",
  requirePermission("calendar.update"),
  async (req, res, next) => {
    try {
      res.json(
        await calendarService.resolveConflict(
          req.db!,
          req.user!,
          requireParam(req, "id"),
          requireParam(req, "conflictId"),
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);
