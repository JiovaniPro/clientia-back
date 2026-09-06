import { describe, expect, it } from "vitest";
import { prisma } from "../src/db/prisma.js";
import * as calendarService from "../src/modules/calendar/service.js";
import { createTestOrganization, createTestUser, ensurePermissionsSeeded } from "./helpers.js";

async function setupEvent(orgName: string, organizerRole = "Agent RDV") {
  const org = await createTestOrganization(orgName);
  const organizer = await createTestUser(org.id, organizerRole);
  const calendar = await calendarService.createCalendar(organizer.db, organizer.authUser, {
    name: "Mon calendrier",
    color: "#1f6f54",
  });
  const event = await calendarService.createEvent(organizer.db, organizer.authUser, {
    calendarId: calendar.id,
    title: "Réunion d'équipe",
    startAt: new Date("2026-09-10T10:00:00.000Z"),
    endAt: new Date("2026-09-10T11:00:00.000Z"),
    type: "MEETING",
  });
  return { org, organizer, event };
}

describe("participants d'événement (sous-lot C2)", () => {
  it("un email externe (aucun compte) est ajouté sans userId résolu", async () => {
    await ensurePermissionsSeeded();
    const { organizer, event } = await setupEvent("Org Attendees External");

    const attendee = await calendarService.addAttendee(organizer.db, organizer.authUser, event.id, {
      email: "partenaire.externe@exemple.com",
      name: "Partenaire Externe",
      role: "OPTIONAL",
    });

    expect(attendee.userId).toBeNull();
    expect(attendee.email).toBe("partenaire.externe@exemple.com");
    expect(attendee.status).toBe("PENDING");
  });

  it("un email correspondant à un compte existant résout automatiquement userId (interne)", async () => {
    await ensurePermissionsSeeded();
    const { organizer, event, org } = await setupEvent("Org Attendees Internal");
    const colleague = await createTestUser(org.id, "Agent calliste");

    const attendee = await calendarService.addAttendee(organizer.db, organizer.authUser, event.id, {
      email: colleague.user.email.toUpperCase(), // casse différente — doit matcher quand même
      role: "REQUIRED",
    });

    expect(attendee.userId).toBe(colleague.user.id);
    expect(attendee.email).toBe(colleague.user.email.toLowerCase());
  });

  it("un email interne avec un nom différent/partiel saisi résout quand même en interne, et le vrai nom du compte remplace la saisie", async () => {
    await ensurePermissionsSeeded();
    const { organizer, event, org } = await setupEvent("Org Attendees Name Mismatch");
    const colleague = await createTestUser(org.id, "Agent calliste");
    await prisma.user.update({
      where: { id: colleague.user.id },
      data: { firstName: "Camille", lastName: "Calliste" },
    });

    const attendee = await calendarService.addAttendee(organizer.db, organizer.authUser, event.id, {
      email: colleague.user.email,
      name: "camille", // nom partiel/différent délibérément — ne doit influencer ni la résolution ni le nom stocké
      role: "REQUIRED",
    });

    expect(attendee.userId).toBe(colleague.user.id); // résolution basée uniquement sur l'email
    expect(attendee.name).toBe("Camille Calliste"); // le vrai nom du compte remplace la saisie, pas "camille"
  });

  it("inviter deux fois le même email au même événement échoue en Conflict propre", async () => {
    await ensurePermissionsSeeded();
    const { organizer, event } = await setupEvent("Org Attendees Duplicate");

    await calendarService.addAttendee(organizer.db, organizer.authUser, event.id, {
      email: "dup@exemple.com",
      role: "REQUIRED",
    });

    await expect(
      calendarService.addAttendee(organizer.db, organizer.authUser, event.id, {
        email: "dup@exemple.com",
        role: "REQUIRED",
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("un utilisateur sans droit d'écriture sur l'événement ne peut pas ajouter/retirer de participant", async () => {
    await ensurePermissionsSeeded();
    const { organizer, event, org } = await setupEvent("Org Attendees Write Guard");
    const stranger = await createTestUser(org.id, "Agent RDV"); // a calendar.update, mais n'est ni organisateur ni agent RDV de CET événement

    await expect(
      calendarService.addAttendee(stranger.db, stranger.authUser, event.id, { email: "x@exemple.com", role: "REQUIRED" }),
    ).rejects.toMatchObject({ statusCode: 403 });

    const attendee = await calendarService.addAttendee(organizer.db, organizer.authUser, event.id, {
      email: "y@exemple.com",
      role: "REQUIRED",
    });
    await expect(
      calendarService.removeAttendee(stranger.db, stranger.authUser, event.id, attendee.id),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("un participant interne peut répondre lui-même à sa propre invitation, même sans calendar.update", async () => {
    await ensurePermissionsSeeded();
    const { organizer, event, org } = await setupEvent("Org Attendees Self Respond");
    const invitee = await createTestUser(org.id, "Agent calliste"); // pas de calendar.update

    const attendee = await calendarService.addAttendee(organizer.db, organizer.authUser, event.id, {
      email: invitee.user.email,
      role: "REQUIRED",
    });

    const updated = await calendarService.updateAttendeeStatus(invitee.db, invitee.authUser, event.id, attendee.id, {
      status: "ACCEPTED",
    });
    expect(updated.status).toBe("ACCEPTED");
    expect(updated.respondedAt).not.toBeNull();
  });

  it("un tiers qui n'est ni l'invité ni organisateur/agent RDV ne peut pas répondre à la place de l'invité", async () => {
    await ensurePermissionsSeeded();
    const { organizer, event, org } = await setupEvent("Org Attendees Self Respond Guard");
    const invitee = await createTestUser(org.id, "Agent calliste");
    const thirdParty = await createTestUser(org.id, "Agent calliste");

    const attendee = await calendarService.addAttendee(organizer.db, organizer.authUser, event.id, {
      email: invitee.user.email,
      role: "REQUIRED",
    });

    await expect(
      calendarService.updateAttendeeStatus(thirdParty.db, thirdParty.authUser, event.id, attendee.id, {
        status: "DECLINED",
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("retirer un participant fonctionne et il n'apparaît plus sur l'événement", async () => {
    await ensurePermissionsSeeded();
    const { organizer, event } = await setupEvent("Org Attendees Remove");

    const attendee = await calendarService.addAttendee(organizer.db, organizer.authUser, event.id, {
      email: "a-retirer@exemple.com",
      role: "REQUIRED",
    });
    await calendarService.removeAttendee(organizer.db, organizer.authUser, event.id, attendee.id);

    const refetched = await calendarService.getEvent(organizer.db, organizer.authUser, event.id);
    expect(refetched.attendees.some((a) => a.id === attendee.id)).toBe(false);
  });

  it("point 2 — inviter un participant interne crée une notification EVENT_INVITATION pour lui", async () => {
    await ensurePermissionsSeeded();
    const { organizer, event, org } = await setupEvent("Org Attendees Notification");
    const invitee = await createTestUser(org.id, "Agent calliste");

    await calendarService.addAttendee(organizer.db, organizer.authUser, event.id, {
      email: invitee.user.email,
      role: "REQUIRED",
    });

    const notifications = await prisma.notification.findMany({ where: { userId: invitee.user.id } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.type).toBe("EVENT_INVITATION");
    expect(notifications[0]?.meta).toMatchObject({ eventId: event.id });
  });

  it("point 2 — inviter un externe ou s'auto-inviter ne crée aucune notification", async () => {
    await ensurePermissionsSeeded();
    const { organizer, event } = await setupEvent("Org Attendees No Self Notification");

    await calendarService.addAttendee(organizer.db, organizer.authUser, event.id, {
      email: "externe@exemple.com",
      role: "REQUIRED",
    });
    await calendarService.addAttendee(organizer.db, organizer.authUser, event.id, {
      email: organizer.user.email,
      role: "REQUIRED",
    });

    const notifications = await prisma.notification.findMany({ where: { userId: organizer.user.id } });
    expect(notifications).toHaveLength(0);
  });

  it("badge du rail — countPendingInvitations reste > 0 tant que l'invitation n'a pas de réponse, indépendamment de l'ancienneté", async () => {
    await ensurePermissionsSeeded();
    const { organizer, event, org } = await setupEvent("Org Pending Invitations Badge");
    const invitee = await createTestUser(org.id, "Agent calliste");

    const beforeInvite = await calendarService.countPendingInvitations(invitee.db, invitee.user.id);
    expect(beforeInvite.count).toBe(0);

    const attendee = await calendarService.addAttendee(organizer.db, organizer.authUser, event.id, {
      email: invitee.user.email,
      role: "REQUIRED",
    });

    const afterInvite = await calendarService.countPendingInvitations(invitee.db, invitee.user.id);
    expect(afterInvite.count).toBe(1);

    // `EventAttendee` n'a pas de champ date de création à filtrer, et
    // countPendingInvitations n'applique aucun filtre temporel : une invitation
    // reste comptée quel que soit son âge, jusqu'à une vraie réponse.
    await calendarService.updateAttendeeStatus(invitee.db, invitee.authUser, event.id, attendee.id, {
      status: "ACCEPTED",
    });
    const afterResponse = await calendarService.countPendingInvitations(invitee.db, invitee.user.id);
    expect(afterResponse.count).toBe(0);
  });

  it("countPendingInvitations reste isolé par organisation", async () => {
    await ensurePermissionsSeeded();
    const { organizer, event, org } = await setupEvent("Org Pending Invitations Isolation A");
    const invitee = await createTestUser(org.id, "Agent calliste");
    await calendarService.addAttendee(organizer.db, organizer.authUser, event.id, {
      email: invitee.user.email,
      role: "REQUIRED",
    });

    const otherOrg = await createTestOrganization("Org Pending Invitations Isolation B");
    const strangerDb = (await createTestUser(otherOrg.id, "Agent calliste")).db;

    // Même id utilisateur interrogé depuis le client scopé d'une AUTRE organisation
    // ne doit jamais remonter l'invitation de la première (isolation multi-tenant).
    const result = await calendarService.countPendingInvitations(strangerDb, invitee.user.id);
    expect(result.count).toBe(0);
  });
});
