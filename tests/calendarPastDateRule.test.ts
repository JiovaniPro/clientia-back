import { describe, expect, it } from "vitest";
import * as calendarService from "../src/modules/calendar/service.js";
import { createTestOrganization, createTestUser, ensurePermissionsSeeded } from "./helpers.js";

async function setup(orgName: string) {
  const org = await createTestOrganization(orgName);
  const user = await createTestUser(org.id, "Agent RDV");
  const calendar = await calendarService.createCalendar(user.db, user.authUser, { name: "Mon calendrier", color: "#1f6f54" });
  return { org, user, calendar };
}

describe("interdiction de créer/déplacer un événement dans le passé (point 4)", () => {
  it("refuse la création avec un startAt déjà passé", async () => {
    await ensurePermissionsSeeded();
    const { user, calendar } = await setup("Org Past Create");

    await expect(
      calendarService.createEvent(user.db, user.authUser, {
        calendarId: calendar.id,
        title: "Réunion",
        startAt: new Date("2020-01-01T10:00:00.000Z"),
        endAt: new Date("2020-01-01T11:00:00.000Z"),
        type: "MEETING",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("accepte la création avec un startAt futur", async () => {
    await ensurePermissionsSeeded();
    const { user, calendar } = await setup("Org Future Create");

    const event = await calendarService.createEvent(user.db, user.authUser, {
      calendarId: calendar.id,
      title: "Réunion",
      startAt: new Date("2026-12-01T10:00:00.000Z"),
      endAt: new Date("2026-12-01T11:00:00.000Z"),
      type: "MEETING",
    });
    expect(event.id).toBeTruthy();
  });

  it("journée entière : autorisé si la date (sans l'heure) n'est pas encore passée", async () => {
    await ensurePermissionsSeeded();
    const { user, calendar } = await setup("Org AllDay Today");
    const today = new Date();
    // Fixe l'heure à minuit local pour simuler la sélection "aujourd'hui" d'un
    // événement journée entière, même si l'heure courante est plus tard dans la journée.
    const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    const event = await calendarService.createEvent(user.db, user.authUser, {
      calendarId: calendar.id,
      title: "Journée entière",
      startAt: todayMidnight,
      endAt: new Date(todayMidnight.getTime() + 24 * 60 * 60_000),
      type: "PERSONAL",
      isAllDay: true,
    });
    expect(event.id).toBeTruthy();
  });

  it("journée entière : refusé pour une date d'hier", async () => {
    await ensurePermissionsSeeded();
    const { user, calendar } = await setup("Org AllDay Yesterday");
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayMidnight = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());

    await expect(
      calendarService.createEvent(user.db, user.authUser, {
        calendarId: calendar.id,
        title: "Journée entière hier",
        startAt: yesterdayMidnight,
        endAt: new Date(yesterdayMidnight.getTime() + 24 * 60 * 60_000),
        type: "PERSONAL",
        isAllDay: true,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("modifier un événement déjà passé sans toucher sa date reste autorisé", async () => {
    await ensurePermissionsSeeded();
    const { user, calendar } = await setup("Org Edit Past No Date Change");
    // Créé directement en base (contourne la règle de création) pour simuler un
    // événement légitimement déjà passé au moment du test.
    const event = await user.db.calendarEvent.create({
      data: {
        organizationId: user.user.organizationId,
        calendarId: calendar.id,
        title: "Réunion passée",
        startAt: new Date("2020-01-01T10:00:00.000Z"),
        endAt: new Date("2020-01-01T11:00:00.000Z"),
        type: "MEETING",
        organizerId: user.user.id,
      },
    });

    const updated = await calendarService.updateEvent(user.db, user.authUser, event.id, {
      description: "Compte-rendu ajouté après coup",
    });
    expect(updated.description).toBe("Compte-rendu ajouté après coup");
  });

  it("déplacer un événement (même déjà passé) vers une nouvelle date passée est refusé", async () => {
    await ensurePermissionsSeeded();
    const { user, calendar } = await setup("Org Edit Past Move Past");
    const event = await user.db.calendarEvent.create({
      data: {
        organizationId: user.user.organizationId,
        calendarId: calendar.id,
        title: "Réunion passée",
        startAt: new Date("2020-01-01T10:00:00.000Z"),
        endAt: new Date("2020-01-01T11:00:00.000Z"),
        type: "MEETING",
        organizerId: user.user.id,
      },
    });

    await expect(
      calendarService.updateEvent(user.db, user.authUser, event.id, {
        startAt: new Date("2020-06-01T10:00:00.000Z"),
        endAt: new Date("2020-06-01T11:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("déplacer un événement futur vers une nouvelle date future reste autorisé", async () => {
    await ensurePermissionsSeeded();
    const { user, calendar } = await setup("Org Edit Future Move Future");
    const event = await calendarService.createEvent(user.db, user.authUser, {
      calendarId: calendar.id,
      title: "Réunion",
      startAt: new Date("2026-12-01T10:00:00.000Z"),
      endAt: new Date("2026-12-01T11:00:00.000Z"),
      type: "MEETING",
    });

    const updated = await calendarService.updateEvent(user.db, user.authUser, event.id, {
      startAt: new Date("2026-12-02T10:00:00.000Z"),
      endAt: new Date("2026-12-02T11:00:00.000Z"),
    });
    expect(updated.startAt.toISOString()).toBe("2026-12-02T10:00:00.000Z");
  });
});
