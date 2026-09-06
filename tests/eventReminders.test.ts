import { describe, expect, it } from "vitest";
import { prisma } from "../src/db/prisma.js";
import * as calendarService from "../src/modules/calendar/service.js";
import { createEventReminderSchema } from "../src/modules/calendar/schema.js";
import { processEventReminders } from "../src/jobs/eventReminders.js";
import { processEmailQueue } from "../src/jobs/emailQueueProcessor.js";
import { createTestOrganization, createTestUser, ensurePermissionsSeeded } from "./helpers.js";

async function setupEvent(orgName: string, overrides: { startAt?: Date; endAt?: Date; recurrenceRule?: string } = {}) {
  const org = await createTestOrganization(orgName);
  const organizer = await createTestUser(org.id, "Agent RDV");
  const calendar = await calendarService.createCalendar(organizer.db, organizer.authUser, {
    name: "Mon calendrier",
    color: "#1f6f54",
  });
  const startAt = overrides.startAt ?? new Date(Date.now() + 60 * 60 * 1000);
  const endAt = overrides.endAt ?? new Date(startAt.getTime() + 60 * 60 * 1000);
  const event = await calendarService.createEvent(organizer.db, organizer.authUser, {
    calendarId: calendar.id,
    title: "Réunion rappels",
    startAt,
    endAt,
    type: "MEETING",
    ...(overrides.recurrenceRule ? { recurrenceRule: overrides.recurrenceRule } : {}),
  });
  return { org, organizer, event };
}

describe("validation du méthode de rappel (sous-lot C3)", () => {
  it("SMS n'existe pas dans l'enum — rejeté par le schéma, pas juste caché côté UI", () => {
    const result = createEventReminderSchema.safeParse({ minutesBefore: 10, method: "SMS" });
    expect(result.success).toBe(false);
  });

  it("POPUP/EMAIL/SOUND sont acceptés", () => {
    for (const method of ["POPUP", "EMAIL", "SOUND"]) {
      expect(createEventReminderSchema.safeParse({ minutesBefore: 10, method }).success).toBe(true);
    }
  });
});

describe("gestion des rappels — organisateur uniquement (sous-lot C3)", () => {
  it("seul l'organisateur peut créer/lister/supprimer un rappel — un agent RDV avec calendar.update mais étranger à l'événement est refusé", async () => {
    await ensurePermissionsSeeded();
    const { org, organizer, event } = await setupEvent("Org Reminders Organizer Only");
    const stranger = await createTestUser(org.id, "Agent RDV"); // a calendar.update, mais n'est pas organisateur de CET événement

    await expect(
      calendarService.createReminder(stranger.db, stranger.authUser, event.id, { minutesBefore: 15, method: "POPUP" }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(calendarService.listReminders(stranger.db, stranger.authUser, event.id)).rejects.toMatchObject({
      statusCode: 403,
    });

    const reminder = await calendarService.createReminder(organizer.db, organizer.authUser, event.id, {
      minutesBefore: 15,
      method: "POPUP",
    });
    await expect(
      calendarService.deleteReminder(stranger.db, stranger.authUser, event.id, reminder.id),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("l'organisateur peut créer plusieurs rappels sur le même événement", async () => {
    await ensurePermissionsSeeded();
    const { organizer, event } = await setupEvent("Org Reminders Multiple");

    await calendarService.createReminder(organizer.db, organizer.authUser, event.id, { minutesBefore: 10, method: "POPUP" });
    // 45 min avant un événement à 60 min : marge confortable pour ne pas être "due"
    // pendant l'exécution de la suite (voir jobs/eventReminders.ts pour les tests
    // qui, eux, scannent explicitement les rappels dus de tous les tests précédents).
    await calendarService.createReminder(organizer.db, organizer.authUser, event.id, { minutesBefore: 45, method: "EMAIL" });

    const reminders = await calendarService.listReminders(organizer.db, organizer.authUser, event.id);
    expect(reminders).toHaveLength(2);
    expect(reminders.map((r) => r.method).sort()).toEqual(["EMAIL", "POPUP"]);
  });

  it("cas limite tranché — un rappel créé sur un événement déjà passé est marqué traité sans envoi, immédiatement", async () => {
    await ensurePermissionsSeeded();
    const { organizer, event } = await setupEvent("Org Reminders Past Event");
    // Backdate direct en base : le service `createEvent` refuse déjà la création
    // dans le passé (§ règle antérieure) — on simule ici un événement devenu
    // passé APRÈS coup (créé futur, puis le temps a filé), seul cas réaliste.
    const pastStart = new Date(Date.now() - 60 * 60 * 1000);
    await prisma.calendarEvent.update({
      where: { id: event.id },
      data: { startAt: pastStart, endAt: new Date(pastStart.getTime() + 60 * 60 * 1000) },
    });

    const reminder = await calendarService.createReminder(organizer.db, organizer.authUser, event.id, {
      minutesBefore: 15,
      method: "POPUP",
    });

    const firing = await prisma.eventReminderFiring.findFirst({ where: { reminderId: reminder.id } });
    expect(firing).not.toBeNull();
    expect(firing?.occurrenceStartAt.getTime()).toBe(pastStart.getTime());

    // Le job ne doit rien envoyer de plus pour cette occurrence déjà marquée.
    // Assertion scopée à CE rappel (pas à l'agrégat global du job) : le job scanne
    // toutes les organisations (même logique que emailQueueProcessor.ts), donc son
    // compteur global peut inclure des rappels d'autres tests/exécutions passées de
    // cette suite redevenus "dus" avec le temps réel qui s'écoule — non représentatif
    // de CE cas précis.
    await processEventReminders();
    const notifications = await prisma.notification.findMany({ where: { userId: organizer.user.id, type: "EVENT_REMINDER" } });
    expect(notifications).toHaveLength(0);
    const firingsAfter = await prisma.eventReminderFiring.findMany({ where: { reminderId: reminder.id } });
    expect(firingsAfter).toHaveLength(1); // toujours la même ligne posée à la création, aucune de plus
  });

  it("un rappel sur un événement futur n'est pas marqué traité à la création", async () => {
    await ensurePermissionsSeeded();
    const { organizer, event } = await setupEvent("Org Reminders Future Event");

    const reminder = await calendarService.createReminder(organizer.db, organizer.authUser, event.id, {
      minutesBefore: 15,
      method: "POPUP",
    });

    const firing = await prisma.eventReminderFiring.findFirst({ where: { reminderId: reminder.id } });
    expect(firing).toBeNull();
  });
});

describe("job de déclenchement — jobs/eventReminders.ts (sous-lot C3)", () => {
  it("méthode POPUP due maintenant crée une notification EVENT_REMINDER pour l'organisateur, avec redirection vers l'événement", async () => {
    await ensurePermissionsSeeded();
    const startAt = new Date(Date.now() + 5 * 60 * 1000); // dans 5 min
    const { organizer, event } = await setupEvent("Org Reminders Popup Due", { startAt });

    await calendarService.createReminder(organizer.db, organizer.authUser, event.id, { minutesBefore: 10, method: "POPUP" });

    await processEventReminders();

    const notifications = await prisma.notification.findMany({ where: { userId: organizer.user.id, type: "EVENT_REMINDER" } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.meta).toMatchObject({ eventId: event.id, method: "POPUP" });
  });

  it("cas limite tranché — un délai qui dépasse le début de l'événement (60 min avant un événement dans 30 min) déclenche immédiatement", async () => {
    await ensurePermissionsSeeded();
    const startAt = new Date(Date.now() + 30 * 60 * 1000); // dans 30 min
    const { organizer, event } = await setupEvent("Org Reminders Overdue Delay", { startAt });

    await calendarService.createReminder(organizer.db, organizer.authUser, event.id, { minutesBefore: 60, method: "SOUND" });

    await processEventReminders();

    const notifications = await prisma.notification.findMany({ where: { userId: organizer.user.id, type: "EVENT_REMINDER" } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.meta).toMatchObject({ method: "SOUND" });
  });

  it("dédup — deux passages successifs du job ne déclenchent le même rappel qu'une seule fois", async () => {
    await ensurePermissionsSeeded();
    const startAt = new Date(Date.now() + 5 * 60 * 1000);
    const { organizer, event } = await setupEvent("Org Reminders Dedup", { startAt });
    const reminder = await calendarService.createReminder(organizer.db, organizer.authUser, event.id, {
      minutesBefore: 10,
      method: "POPUP",
    });

    await processEventReminders();
    await processEventReminders();

    // Compteurs scopés à CE rappel, pas aux agrégats globaux du job (qui, dans
    // cette suite, recomptent aussi les rappels encore "dus" créés par les tests
    // précédents à chaque passage — voir jobs/eventReminders.ts::alreadyFired,
    // non isolé par test par construction, seule la ligne de dédup l'est).
    const firings = await prisma.eventReminderFiring.findMany({ where: { reminderId: reminder.id } });
    expect(firings).toHaveLength(1);

    const notifications = await prisma.notification.findMany({ where: { userId: organizer.user.id, type: "EVENT_REMINDER" } });
    expect(notifications).toHaveLength(1);
  });

  it("méthode EMAIL passe par EmailQueue (retries), pas par un envoi direct", async () => {
    await ensurePermissionsSeeded();
    const startAt = new Date(Date.now() + 5 * 60 * 1000);
    const { organizer, event } = await setupEvent("Org Reminders Email Queue", { startAt });
    await calendarService.createReminder(organizer.db, organizer.authUser, event.id, { minutesBefore: 10, method: "EMAIL" });

    await processEventReminders();

    const queued = await prisma.emailQueue.findMany({ where: { recipientUserId: organizer.user.id } });
    expect(queued).toHaveLength(1);
    expect(queued[0]?.status).toBe("QUEUED");
    expect(queued[0]?.clientId).toBeNull();
    expect(queued[0]?.directSubject).toContain(event.title);

    // Aucune notification EVENT_REMINDER pour la méthode EMAIL (canal distinct).
    const notifications = await prisma.notification.findMany({ where: { userId: organizer.user.id, type: "EVENT_REMINDER" } });
    expect(notifications).toHaveLength(0);
  });

  it("récurrence — chaque occurrence recalculée dans la fenêtre du job reçoit son propre déclenchement, pas seulement le modèle", async () => {
    await ensurePermissionsSeeded();
    const startAt = new Date(Date.now() + 2 * 60 * 1000); // T = dans 2 min
    const { organizer, event } = await setupEvent("Org Reminders Recurrence", {
      startAt,
      recurrenceRule: "FREQ=DAILY;COUNT=3", // occurrences : T, T+1j, T+2j
    });
    // minutesBefore choisi pour couvrir T et T+1j dans une seule fenêtre de scan,
    // mais pas T+2j — preuve que le job traite occurrence par occurrence.
    await calendarService.createReminder(organizer.db, organizer.authUser, event.id, {
      minutesBefore: 1443,
      method: "POPUP",
    });

    await processEventReminders();

    const firings = await prisma.eventReminderFiring.findMany({ where: { eventId: event.id }, orderBy: { occurrenceStartAt: "asc" } });
    expect(firings).toHaveLength(2);
    expect(firings[1]!.occurrenceStartAt.getTime() - firings[0]!.occurrenceStartAt.getTime()).toBe(24 * 60 * 60 * 1000);

    const notifications = await prisma.notification.findMany({ where: { userId: organizer.user.id, type: "EVENT_REMINDER" } });
    expect(notifications).toHaveLength(2);

    // Un second passage ne doit rien redéclencher pour ces deux occurrences déjà traitées.
    await processEventReminders();
    const firingsAfterSecondPass = await prisma.eventReminderFiring.findMany({ where: { eventId: event.id } });
    expect(firingsAfterSecondPass).toHaveLength(2);
  });
});

describe("EmailQueue — branche destinataire interne (sous-lot C3)", () => {
  it("cas limite tranché — adresse invalide chez le destinataire interne échoue proprement (FAILED, pas silencieux)", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Reminders Invalid Email");
    const organizer = await createTestUser(org.id, "Agent RDV");
    // Email invalide écrit directement en base — la validation applicative
    // normale (register/schema) ne permettrait jamais ceci, on simule le cas
    // limite demandé (adresse invalide) plutôt qu'un cas qui ne peut pas arriver
    // via le flux applicatif normal (email absent : le champ est obligatoire).
    await prisma.user.update({ where: { id: organizer.user.id }, data: { email: "pas-une-adresse-valide" } });

    await prisma.emailQueue.create({
      data: {
        organizationId: org.id,
        recipientUserId: organizer.user.id,
        directSubject: "Rappel : test",
        directBody: "corps",
        scheduledAt: new Date(),
      },
    });

    // Assertion scopée à CE destinataire, pas à l'agrégat global du job (qui
    // scanne toutes les organisations — même précaution que pour eventReminders.ts).
    await processEmailQueue();

    const row = await prisma.emailQueue.findFirst({ where: { recipientUserId: organizer.user.id } });
    expect(row?.status).toBe("FAILED");
    expect(row?.errorMessage).toContain("invalide");
  });

  it("adresse valide chez le destinataire interne est traitée avec succès (SMTP simulé en dev)", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Reminders Valid Email");
    const organizer = await createTestUser(org.id, "Agent RDV");

    await prisma.emailQueue.create({
      data: {
        organizationId: org.id,
        recipientUserId: organizer.user.id,
        directSubject: "Rappel : test",
        directBody: "corps",
        scheduledAt: new Date(),
      },
    });

    await processEmailQueue();

    const row = await prisma.emailQueue.findFirst({ where: { recipientUserId: organizer.user.id } });
    expect(row?.status).toBe("SENT");
  });
});
