import { describe, expect, it } from "vitest";
import * as calendarService from "../src/modules/calendar/service.js";
import { HttpError } from "../src/lib/httpError.js";
import { createTestOrganization, createTestUser, ensurePermissionsSeeded } from "./helpers.js";

async function setupOrganizer(orgName: string, roleName = "Agent RDV") {
  const org = await createTestOrganization(orgName);
  const organizer = await createTestUser(org.id, roleName);
  const calendar = await calendarService.createCalendar(organizer.db, organizer.authUser, {
    name: "Mon calendrier",
    color: "#1f6f54",
  });
  return { org, organizer, calendar };
}

describe("sévérité symétrique (bug corrigé — sous-lot B utilisait la durée de l'événement qui se synchronise en dernier)", () => {
  it("un point de 10 min entièrement inclus dans un bloc de 60 min est CRITIQUE, que le point soit créé avant ou après le bloc", async () => {
    await ensurePermissionsSeeded();

    // Ordre 1 : le bloc (60 min) est créé D'ABORD, le point (10 min) ensuite —
    // c'est donc le point qui déclenche la dernière synchronisation.
    const setup1 = await setupOrganizer("Org Severity Order 1");
    const block1 = await calendarService.createEvent(setup1.organizer.db, setup1.organizer.authUser, {
      calendarId: setup1.calendar.id,
      title: "Bloc 60 min",
      startAt: new Date("2026-11-02T10:00:00.000Z"),
      endAt: new Date("2026-11-02T11:00:00.000Z"),
      type: "MEETING",
    });
    const point1 = await calendarService.createEvent(setup1.organizer.db, setup1.organizer.authUser, {
      calendarId: setup1.calendar.id,
      title: "Point 10 min",
      startAt: new Date("2026-11-02T10:20:00.000Z"),
      endAt: new Date("2026-11-02T10:30:00.000Z"),
      type: "MEETING",
    });
    const pointDetail1 = await calendarService.getEvent(setup1.organizer.db, setup1.organizer.authUser, point1.id);
    expect(pointDetail1.conflicts).toHaveLength(1);
    expect(pointDetail1.conflicts[0]?.severity).toBe("CRITICAL");
    const blockDetail1 = await calendarService.getEvent(setup1.organizer.db, setup1.organizer.authUser, block1.id);
    expect(blockDetail1.conflicts).toHaveLength(1);
    expect(blockDetail1.conflicts[0]?.severity).toBe("CRITICAL");

    // Ordre 2 : le point (10 min) est créé D'ABORD, le bloc (60 min) ensuite —
    // c'est cette fois le bloc qui déclenche la dernière synchronisation. Avec
    // l'ancien calcul (dénominateur = durée de l'événement synchronisé en dernier),
    // ceci aurait donné 10/60 = 17 % => INFO au lieu de CRITICAL.
    const setup2 = await setupOrganizer("Org Severity Order 2");
    const point2 = await calendarService.createEvent(setup2.organizer.db, setup2.organizer.authUser, {
      calendarId: setup2.calendar.id,
      title: "Point 10 min",
      startAt: new Date("2026-11-02T10:20:00.000Z"),
      endAt: new Date("2026-11-02T10:30:00.000Z"),
      type: "MEETING",
    });
    const block2 = await calendarService.createEvent(setup2.organizer.db, setup2.organizer.authUser, {
      calendarId: setup2.calendar.id,
      title: "Bloc 60 min",
      startAt: new Date("2026-11-02T10:00:00.000Z"),
      endAt: new Date("2026-11-02T11:00:00.000Z"),
      type: "MEETING",
    });
    const point2Detail = await calendarService.getEvent(setup2.organizer.db, setup2.organizer.authUser, point2.id);
    // Sans le fix conflictsB (voir describe suivant), ce test échouerait aussi pour
    // une deuxième raison : point2 n'a jamais déclenché sa propre resynchronisation
    // après la création du bloc, donc son conflit ne serait visible que via conflictsB.
    expect(point2Detail.conflicts).toHaveLength(1);
    expect(point2Detail.conflicts[0]?.severity).toBe("CRITICAL");
    const block2Detail = await calendarService.getEvent(setup2.organizer.db, setup2.organizer.authUser, block2.id);
    expect(block2Detail.conflicts).toHaveLength(1);
    expect(block2Detail.conflicts[0]?.severity).toBe("CRITICAL");
  });

  it("50% de chevauchement (deux événements de 60 min décalés de 30 min) reste WARNING dans les deux sens", async () => {
    await ensurePermissionsSeeded();
    const { organizer, calendar } = await setupOrganizer("Org Severity Warning");
    const a = await calendarService.createEvent(organizer.db, organizer.authUser, {
      calendarId: calendar.id,
      title: "A",
      startAt: new Date("2026-11-03T09:00:00.000Z"),
      endAt: new Date("2026-11-03T10:00:00.000Z"),
      type: "MEETING",
    });
    const b = await calendarService.createEvent(organizer.db, organizer.authUser, {
      calendarId: calendar.id,
      title: "B",
      startAt: new Date("2026-11-03T09:30:00.000Z"),
      endAt: new Date("2026-11-03T10:30:00.000Z"),
      type: "MEETING",
    });
    const aDetail = await calendarService.getEvent(organizer.db, organizer.authUser, a.id);
    expect(aDetail.conflicts[0]?.severity).toBe("WARNING");
    const bDetail = await calendarService.getEvent(organizer.db, organizer.authUser, b.id);
    expect(bDetail.conflicts[0]?.severity).toBe("WARNING");
  });
});

describe("conflictsB (bug corrigé — getEvent n'incluait que conflictsA)", () => {
  it("l'événement créé EN PREMIER voit aussi le conflit, même s'il n'a jamais été resynchronisé", async () => {
    await ensurePermissionsSeeded();
    const { organizer, calendar } = await setupOrganizer("Org ConflictsB");
    const first = await calendarService.createEvent(organizer.db, organizer.authUser, {
      calendarId: calendar.id,
      title: "Premier événement",
      startAt: new Date("2026-11-04T14:00:00.000Z"),
      endAt: new Date("2026-11-04T15:00:00.000Z"),
      type: "MEETING",
    });
    const second = await calendarService.createEvent(organizer.db, organizer.authUser, {
      calendarId: calendar.id,
      title: "Second événement (chevauche le premier)",
      startAt: new Date("2026-11-04T14:30:00.000Z"),
      endAt: new Date("2026-11-04T15:30:00.000Z"),
      type: "MEETING",
    });

    // `second` a déclenché sa propre synchronisation : eventId=second, conflictingId=first.
    // `first` n'a JAMAIS été resynchronisé depuis — son conflit ne peut venir que de
    // conflictsB (conflictingId=first). Sans le fix, cette assertion échouait (conflicts: []).
    const firstDetail = await calendarService.getEvent(organizer.db, organizer.authUser, first.id);
    expect(firstDetail.conflicts).toHaveLength(1);
    expect(firstDetail.conflicts[0]?.otherEvent.id).toBe(second.id);

    const secondDetail = await calendarService.getEvent(organizer.db, organizer.authUser, second.id);
    expect(secondDetail.conflicts).toHaveLength(1);
    expect(secondDetail.conflicts[0]?.otherEvent.id).toBe(first.id);
  });
});

describe("portée multi-calendrier (décision actée : calendriers visibles de l'organisateur)", () => {
  it("détecte un conflit entre deux calendriers PERSONNELS du même organisateur", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Multi Calendar Same Owner");
    const organizer = await createTestUser(org.id, "Agent RDV");
    const calendarA = await calendarService.createCalendar(organizer.db, organizer.authUser, { name: "Pro", color: "#1f6f54" });
    const calendarB = await calendarService.createCalendar(organizer.db, organizer.authUser, { name: "Perso", color: "#c2410c" });

    const eventA = await calendarService.createEvent(organizer.db, organizer.authUser, {
      calendarId: calendarA.id,
      title: "Réunion pro",
      startAt: new Date("2026-11-05T10:00:00.000Z"),
      endAt: new Date("2026-11-05T11:00:00.000Z"),
      type: "MEETING",
    });
    const eventB = await calendarService.createEvent(organizer.db, organizer.authUser, {
      calendarId: calendarB.id,
      title: "Rendez-vous perso",
      startAt: new Date("2026-11-05T10:30:00.000Z"),
      endAt: new Date("2026-11-05T11:30:00.000Z"),
      type: "PERSONAL",
    });

    const detailA = await calendarService.getEvent(organizer.db, organizer.authUser, eventA.id);
    expect(detailA.conflicts).toHaveLength(1);
    expect(detailA.conflicts[0]?.otherEvent.id).toBe(eventB.id);
  });

  it("ne détecte AUCUN conflit entre les calendriers privés de deux organisateurs différents", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Multi Calendar Isolation");
    const userA = await createTestUser(org.id, "Agent RDV");
    const userB = await createTestUser(org.id, "Agent RDV");
    const calendarA = await calendarService.createCalendar(userA.db, userA.authUser, { name: "Calendrier A", color: "#1f6f54" });
    const calendarB = await calendarService.createCalendar(userB.db, userB.authUser, { name: "Calendrier B", color: "#c2410c" });

    const eventA = await calendarService.createEvent(userA.db, userA.authUser, {
      calendarId: calendarA.id,
      title: "Événement A",
      startAt: new Date("2026-11-06T10:00:00.000Z"),
      endAt: new Date("2026-11-06T11:00:00.000Z"),
      type: "MEETING",
    });
    const eventB = await calendarService.createEvent(userB.db, userB.authUser, {
      calendarId: calendarB.id,
      title: "Événement B",
      startAt: new Date("2026-11-06T10:30:00.000Z"),
      endAt: new Date("2026-11-06T11:30:00.000Z"),
      type: "MEETING",
    });

    const detailA = await calendarService.getEvent(userA.db, userA.authUser, eventA.id);
    expect(detailA.conflicts).toHaveLength(0);
    const detailB = await calendarService.getEvent(userB.db, userB.authUser, eventB.id);
    expect(detailB.conflicts).toHaveLength(0);
  });

  it("détecte un conflit via un calendrier GLOBAL visible par l'organisateur, même s'il ne lui appartient pas", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Multi Calendar Global");
    const owner = await createTestUser(org.id, "Agent RDV");
    const organizer = await createTestUser(org.id, "Agent RDV");
    const globalCalendar = await calendarService.createCalendar(owner.db, owner.authUser, { name: "Calendrier global", color: "#3b6e91" });
    // `isGlobal` n'est exposé par aucun endpoint (createCalendarSchema ne le prévoit
    // pas) — écriture directe en base, légitime pour poser l'état du test.
    await owner.db.calendar.update({ where: { id: globalCalendar.id }, data: { isGlobal: true } });

    const globalEvent = await calendarService.createEvent(owner.db, owner.authUser, {
      calendarId: globalCalendar.id,
      title: "Événement sur calendrier global",
      startAt: new Date("2026-11-07T10:00:00.000Z"),
      endAt: new Date("2026-11-07T11:00:00.000Z"),
      type: "MEETING",
    });
    const personalCalendar = await calendarService.createCalendar(organizer.db, organizer.authUser, { name: "Mon calendrier", color: "#1f6f54" });
    const personalEvent = await calendarService.createEvent(organizer.db, organizer.authUser, {
      calendarId: personalCalendar.id,
      title: "Mon événement",
      startAt: new Date("2026-11-07T10:30:00.000Z"),
      endAt: new Date("2026-11-07T11:30:00.000Z"),
      type: "MEETING",
    });

    const detail = await calendarService.getEvent(organizer.db, organizer.authUser, personalEvent.id);
    expect(detail.conflicts).toHaveLength(1);
    expect(detail.conflicts[0]?.otherEvent.id).toBe(globalEvent.id);
  });
});

describe("availability FREE — jamais de conflit", () => {
  it("un événement FREE ne génère aucun conflit, ni comme source ni comme candidat", async () => {
    await ensurePermissionsSeeded();
    const { organizer, calendar } = await setupOrganizer("Org Free Availability");
    const busy = await calendarService.createEvent(organizer.db, organizer.authUser, {
      calendarId: calendar.id,
      title: "Occupé",
      startAt: new Date("2026-11-08T10:00:00.000Z"),
      endAt: new Date("2026-11-08T11:00:00.000Z"),
      type: "MEETING",
    });
    const free = await calendarService.createEvent(organizer.db, organizer.authUser, {
      calendarId: calendar.id,
      title: "Libre",
      startAt: new Date("2026-11-08T10:30:00.000Z"),
      endAt: new Date("2026-11-08T11:30:00.000Z"),
      type: "PERSONAL",
      availability: "FREE",
    });

    const busyDetail = await calendarService.getEvent(organizer.db, organizer.authUser, busy.id);
    expect(busyDetail.conflicts).toHaveLength(0);
    const freeDetail = await calendarService.getEvent(organizer.db, organizer.authUser, free.id);
    expect(freeDetail.conflicts).toHaveLength(0);
  });
});

describe("résolution d'un conflit — accessible à qui peut écrire sur l'un des deux événements", () => {
  it("un tiers sans droit d'écriture sur aucun des deux événements reçoit un 403", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Resolve Forbidden");
    const userA = await createTestUser(org.id, "Agent RDV");
    const userB = await createTestUser(org.id, "Agent RDV");
    const stranger = await createTestUser(org.id, "Agent calliste");
    const calA = await calendarService.createCalendar(userA.db, userA.authUser, { name: "A", color: "#1f6f54" });
    const eventA = await calendarService.createEvent(userA.db, userA.authUser, {
      calendarId: calA.id,
      title: "Événement A",
      startAt: new Date("2026-11-09T10:00:00.000Z"),
      endAt: new Date("2026-11-09T11:00:00.000Z"),
      type: "MEETING",
    });
    await calendarService.createEvent(userA.db, userA.authUser, {
      calendarId: calA.id,
      title: "Événement B (même calendrier, même organisateur pour isoler le test de résolution)",
      startAt: new Date("2026-11-09T10:30:00.000Z"),
      endAt: new Date("2026-11-09T11:30:00.000Z"),
      type: "MEETING",
    });
    const detail = await calendarService.getEvent(userA.db, userA.authUser, eventA.id);
    const conflictId = detail.conflicts[0]!.id;

    await expect(calendarService.resolveConflict(stranger.db, stranger.authUser, eventA.id, conflictId)).rejects.toThrow(
      HttpError,
    );
    void userB;
  });

  it("un utilisateur qui peut écrire sur SEULEMENT l'un des deux événements peut résoudre le conflit", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Resolve Either Side");
    const userA = await createTestUser(org.id, "Agent RDV");
    const userB = await createTestUser(org.id, "Agent RDV");
    const calA = await calendarService.createCalendar(userA.db, userA.authUser, { name: "A", color: "#1f6f54" });
    const calB = await calendarService.createCalendar(userB.db, userB.authUser, { name: "B", color: "#c2410c" });
    await userA.db.calendar.update({ where: { id: calB.id }, data: { isGlobal: true } });

    const eventA = await calendarService.createEvent(userA.db, userA.authUser, {
      calendarId: calA.id,
      title: "Événement A",
      startAt: new Date("2026-11-10T10:00:00.000Z"),
      endAt: new Date("2026-11-10T11:00:00.000Z"),
      type: "MEETING",
    });
    const eventB = await calendarService.createEvent(userB.db, userB.authUser, {
      calendarId: calB.id,
      title: "Événement B",
      startAt: new Date("2026-11-10T10:30:00.000Z"),
      endAt: new Date("2026-11-10T11:30:00.000Z"),
      type: "MEETING",
    });

    const detailA = await calendarService.getEvent(userA.db, userA.authUser, eventA.id);
    const conflictId = detailA.conflicts[0]!.id;
    expect(detailA.conflicts[0]?.isResolved).toBe(false);

    // userB n'est pas organisateur d'A, mais PEUT écrire sur B (l'autre côté de la paire).
    // Résolu depuis le panneau de B (eventB.id) — otherEvent doit alors pointer vers A.
    const resolved = await calendarService.resolveConflict(userB.db, userB.authUser, eventB.id, conflictId);
    expect(resolved.isResolved).toBe(true);
    expect(resolved.resolvedBy?.id).toBe(userB.user.id);
    expect(resolved.otherEvent.id).toBe(eventA.id);

    // Idempotent : un second appel (par n'importe lequel des deux côtés) ne relève pas d'erreur.
    const resolvedAgain = await calendarService.resolveConflict(userA.db, userA.authUser, eventA.id, conflictId);
    expect(resolvedAgain.isResolved).toBe(true);
    expect(resolvedAgain.otherEvent.id).toBe(eventB.id);
  });

  it("un conflit résolu disparaît de conflictSeverity (listEvents) mais reste visible dans getEvent", async () => {
    await ensurePermissionsSeeded();
    const { organizer, calendar } = await setupOrganizer("Org Resolve Grid Severity");
    const a = await calendarService.createEvent(organizer.db, organizer.authUser, {
      calendarId: calendar.id,
      title: "A",
      startAt: new Date("2026-11-11T10:00:00.000Z"),
      endAt: new Date("2026-11-11T11:00:00.000Z"),
      type: "MEETING",
    });
    await calendarService.createEvent(organizer.db, organizer.authUser, {
      calendarId: calendar.id,
      title: "B",
      startAt: new Date("2026-11-11T10:05:00.000Z"),
      endAt: new Date("2026-11-11T11:05:00.000Z"),
      type: "MEETING",
    });

    const before = await calendarService.listEvents(organizer.db, organizer.authUser, {
      from: new Date("2026-11-11T00:00:00.000Z"),
      to: new Date("2026-11-12T00:00:00.000Z"),
    });
    const aInGridBefore = before.find((e) => e.id === a.id) as { conflictSeverity: string | null };
    expect(aInGridBefore.conflictSeverity).not.toBeNull();

    const detail = await calendarService.getEvent(organizer.db, organizer.authUser, a.id);
    await calendarService.resolveConflict(organizer.db, organizer.authUser, a.id, detail.conflicts[0]!.id);

    const after = await calendarService.listEvents(organizer.db, organizer.authUser, {
      from: new Date("2026-11-11T00:00:00.000Z"),
      to: new Date("2026-11-12T00:00:00.000Z"),
    });
    const aInGridAfter = after.find((e) => e.id === a.id) as { conflictSeverity: string | null };
    expect(aInGridAfter.conflictSeverity).toBeNull();

    const detailAfter = await calendarService.getEvent(organizer.db, organizer.authUser, a.id);
    expect(detailAfter.conflicts).toHaveLength(1);
    expect(detailAfter.conflicts[0]?.isResolved).toBe(true);
  });
});

describe("suggestSlots — créneaux libres suggérés", () => {
  it("propose le tout début de la plage de travail quand rien n'est occupé", async () => {
    await ensurePermissionsSeeded();
    const { organizer } = await setupOrganizer("Org Suggest Empty");
    // Un jour ouvré loin dans le futur, choisi explicitement (mardi).
    const preferredDate = new Date("2026-12-01T00:00:00.000Z"); // mardi
    const slots = await calendarService.suggestSlots(organizer.db, organizer.authUser, {
      durationMinutes: 30,
      preferredDate,
      workStartHour: 8,
      workEndHour: 18,
    });
    expect(slots.length).toBeGreaterThan(0);
    // Heures locales (comme l'implémentation, cohérent avec le reste du code —
    // voir assertNotInPast — qui raisonne déjà en composants de Date locaux, pas
    // UTC) : le fuseau de la machine de test n'est pas forcément UTC.
    expect(slots[0]!.startAt.getHours()).toBe(8);
    expect(slots[0]!.startAt.getMinutes()).toBe(0);
  });

  it("saute un événement existant et propose le créneau juste après", async () => {
    await ensurePermissionsSeeded();
    const { organizer, calendar } = await setupOrganizer("Org Suggest Busy");
    // Construit en heure locale (8h-9h locales), pour matcher exactement la
    // fenêtre de travail locale que suggestSlots calcule via setHours(workStart).
    const busyStart = new Date("2026-12-01T00:00:00.000Z");
    busyStart.setHours(8, 0, 0, 0);
    const busyEnd = new Date("2026-12-01T00:00:00.000Z");
    busyEnd.setHours(9, 0, 0, 0);
    await calendarService.createEvent(organizer.db, organizer.authUser, {
      calendarId: calendar.id,
      title: "Occupé",
      startAt: busyStart,
      endAt: busyEnd,
      type: "MEETING",
    });
    const slots = await calendarService.suggestSlots(organizer.db, organizer.authUser, {
      durationMinutes: 30,
      preferredDate: new Date("2026-12-01T00:00:00.000Z"),
      workStartHour: 8,
      workEndHour: 18,
    });
    expect(slots[0]!.startAt.getHours()).toBe(9);
    expect(slots[0]!.startAt.getMinutes()).toBe(0);
  });

  it("saute le week-end (préférence un samedi -> premier créneau le lundi suivant)", async () => {
    await ensurePermissionsSeeded();
    const { organizer } = await setupOrganizer("Org Suggest Weekend");
    // 2026-12-05 est un samedi, 2026-12-07 le lundi suivant.
    const slots = await calendarService.suggestSlots(organizer.db, organizer.authUser, {
      durationMinutes: 30,
      preferredDate: new Date("2026-12-05T00:00:00.000Z"),
      workStartHour: 8,
      workEndHour: 18,
    });
    expect(slots[0]!.startAt.toISOString().slice(0, 10)).toBe("2026-12-07");
  });

  it("rejette une durée qui dépasse la plage de travail", async () => {
    await ensurePermissionsSeeded();
    const { organizer } = await setupOrganizer("Org Suggest TooLong");
    await expect(
      calendarService.suggestSlots(organizer.db, organizer.authUser, {
        durationMinutes: 700,
        preferredDate: new Date("2026-12-01T00:00:00.000Z"),
        workStartHour: 8,
        workEndHour: 18,
      }),
    ).rejects.toThrow(HttpError);
  });

  it("respecte les heures de travail enregistrées dans Setting quand aucun override n'est fourni", async () => {
    await ensurePermissionsSeeded();
    const { organizer } = await setupOrganizer("Org Suggest StoredHours");
    await organizer.db.setting.create({
      data: { organizationId: organizer.user.organizationId, userId: organizer.user.id, key: "calendar.workingHours", value: { start: 9, end: 17 } },
    });
    const slots = await calendarService.suggestSlots(organizer.db, organizer.authUser, {
      durationMinutes: 30,
      preferredDate: new Date("2026-12-01T00:00:00.000Z"),
    });
    expect(slots[0]!.startAt.getHours()).toBe(9);
  });
});
