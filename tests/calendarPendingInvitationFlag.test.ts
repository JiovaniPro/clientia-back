import { describe, expect, it } from "vitest";
import * as calendarService from "../src/modules/calendar/service.js";
import { createTestOrganization, createTestUser, ensurePermissionsSeeded } from "./helpers.js";

describe("indicateur hasPendingInvitation sur listEvents (point 3)", () => {
  it("un événement où l'utilisateur a une invitation PENDING porte hasPendingInvitation: true", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Pending Flag");
    const organizer = await createTestUser(org.id, "Agent RDV");
    const invitee = await createTestUser(org.id, "Agent calliste");
    const calendar = await calendarService.createCalendar(organizer.db, organizer.authUser, {
      name: "Mon calendrier",
      color: "#1f6f54",
    });
    const event = await calendarService.createEvent(organizer.db, organizer.authUser, {
      calendarId: calendar.id,
      title: "Réunion",
      startAt: new Date("2026-12-01T10:00:00.000Z"),
      endAt: new Date("2026-12-01T11:00:00.000Z"),
      type: "MEETING",
    });
    await calendarService.addAttendee(organizer.db, organizer.authUser, event.id, {
      email: invitee.user.email,
      role: "REQUIRED",
    });

    const inviteeEvents = await calendarService.listEvents(invitee.db, invitee.authUser, {
      from: new Date("2026-11-01T00:00:00.000Z"),
      to: new Date("2027-01-01T00:00:00.000Z"),
    });
    const seen = inviteeEvents.find((e) => e.id === event.id);
    expect(seen?.hasPendingInvitation).toBe(true);

    // Pour l'organisateur (pas invité lui-même), l'indicateur doit rester faux.
    const organizerEvents = await calendarService.listEvents(organizer.db, organizer.authUser, {
      from: new Date("2026-11-01T00:00:00.000Z"),
      to: new Date("2027-01-01T00:00:00.000Z"),
    });
    expect(organizerEvents.find((e) => e.id === event.id)?.hasPendingInvitation).toBe(false);
  });

  it("répondre à l'invitation (Accepté/Décliné) fait disparaître l'indicateur", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Pending Flag Respond");
    const organizer = await createTestUser(org.id, "Agent RDV");
    const invitee = await createTestUser(org.id, "Agent calliste");
    const calendar = await calendarService.createCalendar(organizer.db, organizer.authUser, {
      name: "Mon calendrier",
      color: "#1f6f54",
    });
    const event = await calendarService.createEvent(organizer.db, organizer.authUser, {
      calendarId: calendar.id,
      title: "Réunion",
      startAt: new Date("2026-12-01T10:00:00.000Z"),
      endAt: new Date("2026-12-01T11:00:00.000Z"),
      type: "MEETING",
    });
    const attendee = await calendarService.addAttendee(organizer.db, organizer.authUser, event.id, {
      email: invitee.user.email,
      role: "REQUIRED",
    });
    await calendarService.updateAttendeeStatus(invitee.db, invitee.authUser, event.id, attendee.id, {
      status: "ACCEPTED",
    });

    const inviteeEvents = await calendarService.listEvents(invitee.db, invitee.authUser, {
      from: new Date("2026-11-01T00:00:00.000Z"),
      to: new Date("2027-01-01T00:00:00.000Z"),
    });
    expect(inviteeEvents.find((e) => e.id === event.id)?.hasPendingInvitation).toBe(false);
  });
});
