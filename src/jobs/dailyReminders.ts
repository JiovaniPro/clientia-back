import cron from "node-cron";
import { prisma } from "../db/prisma.js";
import { getScopedClient } from "../db/scopedClient.js";
import { enqueueEmail } from "../modules/emails/service.js";

const ACTIVE_APPOINTMENT_STATUSES = ["EN_ATTENTE_DE_CONFIRMATION", "CONFIRME"] as const;

function tomorrowWindow(now: Date) {
  const start = new Date(now);
  start.setDate(start.getDate() + 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

/**
 * Scan quotidien des rendez-vous actifs du lendemain, enqueue un rappel pour chacun
 * (second des deux seuls cas réellement automatisés — voir décision #2). Chaque
 * événement ne tombe dans la fenêtre "lendemain" qu'une seule fois, donc pas besoin
 * de déduplication ici — celle du queue processor sert de filet de sécurité.
 */
export async function enqueueTomorrowAppointmentReminders() {
  const { start, end } = tomorrowWindow(new Date());

  const events = await prisma.calendarEvent.findMany({
    where: {
      type: "APPOINTMENT",
      status: { in: [...ACTIVE_APPOINTMENT_STATUSES] },
      clientId: { not: null },
      startAt: { gte: start, lte: end },
    },
  });

  let enqueued = 0;
  for (const event of events) {
    if (!event.clientId) continue;
    const db = getScopedClient(event.organizationId);
    const result = await enqueueEmail(db, event.organizationId, {
      clientId: event.clientId,
      templateKey: "rappel_veille",
      appointmentEventId: event.id,
      scheduledAt: new Date(),
    });
    if (result) enqueued++;
  }

  return { scanned: events.length, enqueued };
}

/** Tous les jours à 8h locales. */
export function scheduleDailyReminders() {
  cron.schedule("0 8 * * *", () => {
    enqueueTomorrowAppointmentReminders().catch((error) => console.error("[dailyReminders]", error));
  });
}
