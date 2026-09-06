import cron from "node-cron";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";
import { getScopedClient } from "../db/scopedClient.js";
import { createNotification } from "../lib/notifications.js";
import { enqueueReminderEmail } from "../modules/emails/service.js";
import { expandRecurrence } from "../lib/rrule.js";

const dateTimeFormatter = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short" });

interface DueOccurrence {
  reminderId: string;
  eventId: string;
  organizationId: string;
  organizerId: string;
  method: "POPUP" | "EMAIL" | "SOUND";
  eventTitle: string;
  occurrenceStartAt: Date;
}

/**
 * Sous-lot C3 — un `EventReminder` récurrent doit se déclencher à CHAQUE
 * occurrence recalculée (décision actée), pas seulement à `event.startAt` du
 * modèle. Fenêtre d'expansion bornée à exactement [maintenant, maintenant +
 * minutesBefore] : c'est la seule plage où une occurrence peut être "due"
 * maintenant (dueAt = start - minutesBefore <= now) tout en étant encore future
 * (start > now, cas limite "délai dépassé" — voir plus bas). Pas besoin de
 * scanner plus large : un job par minute rattrape naturellement la fenêtre
 * suivante au passage suivant.
 */
function findDueOccurrences(
  reminder: { id: string; minutesBefore: number; method: "POPUP" | "EMAIL" | "SOUND" },
  event: {
    id: string;
    organizationId: string;
    organizerId: string;
    title: string;
    startAt: Date;
    endAt: Date;
    isRecurring: boolean;
    recurrenceRule: string | null;
    exceptionDates: unknown;
  },
  now: Date,
): DueOccurrence[] {
  const base = {
    reminderId: reminder.id,
    eventId: event.id,
    organizationId: event.organizationId,
    organizerId: event.organizerId,
    method: reminder.method,
    eventTitle: event.title,
  };

  if (event.isRecurring && event.recurrenceRule) {
    const windowEnd = new Date(now.getTime() + reminder.minutesBefore * 60_000);
    const occurrences = expandRecurrence(
      { startAt: event.startAt, endAt: event.endAt, recurrenceRule: event.recurrenceRule, exceptionDates: event.exceptionDates },
      now,
      windowEnd,
    );
    return occurrences
      .filter((occurrence) => {
        const dueAt = new Date(occurrence.start.getTime() - reminder.minutesBefore * 60_000);
        return dueAt <= now && occurrence.start > now;
      })
      .map((occurrence) => ({ ...base, occurrenceStartAt: occurrence.start }));
  }

  const dueAt = new Date(event.startAt.getTime() - reminder.minutesBefore * 60_000);
  if (dueAt <= now && event.startAt > now) {
    return [{ ...base, occurrenceStartAt: event.startAt }];
  }
  return [];
}

/**
 * Scan par minute de tous les `EventReminder` (toutes organisations, via le
 * client de base — même pattern que jobs/emailQueueProcessor.ts), déclenche
 * ceux dont l'échéance est atteinte pour l'occurrence courante.
 *
 * Ordre déclaré volontaire : on envoie/enqueue D'ABORD, on écrit la ligne de
 * dédup `EventReminderFiring` APRÈS. Les deux écritures ne sont pas dans une
 * transaction (aucun autre job de ce projet n'en utilise pour des écritures
 * adjacentes de ce type — voir emailQueueProcessor.ts) : en cas d'échec entre
 * les deux, le pire scénario est un rappel envoyé deux fois au passage suivant
 * (la ligne de dédup n'existe pas encore), jamais un rappel silencieusement
 * perdu — direction de repli délibérément choisie.
 */
export async function processEventReminders() {
  const now = new Date();

  const reminders = await prisma.eventReminder.findMany({ include: { event: true } });

  const due = reminders.flatMap((reminder) => findDueOccurrences(reminder, reminder.event, now));

  let fired = 0;
  let alreadyFired = 0;

  for (const item of due) {
    const db = getScopedClient(item.organizationId);

    const alreadyLogged = await db.eventReminderFiring.findFirst({
      where: { reminderId: item.reminderId, occurrenceStartAt: item.occurrenceStartAt },
    });
    if (alreadyLogged) {
      alreadyFired++;
      continue;
    }

    const label = dateTimeFormatter.format(item.occurrenceStartAt);
    if (item.method === "EMAIL") {
      await enqueueReminderEmail(db, item.organizationId, {
        recipientUserId: item.organizerId,
        subject: `Rappel : ${item.eventTitle}`,
        body: `Votre événement « ${item.eventTitle} » commence le ${label}.`,
      });
    } else {
      await createNotification(db, {
        organizationId: item.organizationId,
        userId: item.organizerId,
        type: "EVENT_REMINDER",
        title: `Rappel : ${item.eventTitle}`,
        body: label,
        meta: { eventId: item.eventId, method: item.method, occurrenceStartAt: item.occurrenceStartAt.toISOString() },
      });
    }

    try {
      await db.eventReminderFiring.create({
        data: { reminderId: item.reminderId, eventId: item.eventId, occurrenceStartAt: item.occurrenceStartAt },
      });
    } catch (error) {
      // Contrainte unique déjà posée par un passage concurrent — pas une vraie
      // erreur, juste un signal "déjà traité entre-temps".
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
    }
    fired++;
  }

  return { scanned: reminders.length, dueOccurrences: due.length, fired, alreadyFired };
}

/** Toutes les minutes — granularité la plus fine que ce projet utilise déjà pour un cron. */
export function scheduleEventReminders() {
  cron.schedule("* * * * *", () => {
    processEventReminders().catch((error) => console.error("[eventReminders]", error));
  });
}
