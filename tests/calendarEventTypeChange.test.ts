import { describe, expect, it } from "vitest";
import * as calendarService from "../src/modules/calendar/service.js";
import { createTestOrganization, createTestUser, ensurePermissionsSeeded } from "./helpers.js";

async function createTestCall(db: Awaited<ReturnType<typeof createTestUser>>["db"], org: { id: string }, user: { id: string }, toNumber: string) {
  const status = await db.configurableListItem.findFirstOrThrow({ where: { listKey: "CALL_STATUS", isDefault: true } });
  return db.call.create({
    data: {
      organizationId: org.id,
      userId: user.id,
      direction: "OUTBOUND",
      type: "PROSPECTION",
      statusId: status.id,
      fromNumber: "+33600000000",
      toNumber,
      occurredAt: new Date("2026-09-01T09:00:00.000Z"),
    },
  });
}

async function setupWithCall(orgName: string) {
  const org = await createTestOrganization(orgName);
  const agentRdv = await createTestUser(org.id, "Agent RDV");
  const calendar = await calendarService.createCalendar(agentRdv.db, agentRdv.authUser, {
    name: "Mon calendrier",
    color: "#1f6f54",
  });
  const call = await createTestCall(agentRdv.db, org, agentRdv.user, "+33611111111");
  return { org, agentRdv, calendar, call };
}

describe("changement de type d'événement après création (point 3)", () => {
  it("passer une Réunion en Rendez-vous sans callId échoue en BadRequest", async () => {
    await ensurePermissionsSeeded();
    const { agentRdv, calendar } = await setupWithCall("Org TypeChange No Call");
    const event = await calendarService.createEvent(agentRdv.db, agentRdv.authUser, {
      calendarId: calendar.id,
      title: "Réunion",
      startAt: new Date("2026-09-10T10:00:00.000Z"),
      endAt: new Date("2026-09-10T11:00:00.000Z"),
      type: "MEETING",
    });

    await expect(
      calendarService.updateEvent(agentRdv.db, agentRdv.authUser, event.id, { type: "APPOINTMENT" }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("passer une Réunion en Rendez-vous avec callId fonctionne : statut EN_ATTENTE_DE_CONFIRMATION posé, historique créé", async () => {
    await ensurePermissionsSeeded();
    const { agentRdv, calendar, call } = await setupWithCall("Org TypeChange To Appointment");
    const event = await calendarService.createEvent(agentRdv.db, agentRdv.authUser, {
      calendarId: calendar.id,
      title: "Réunion",
      startAt: new Date("2026-09-10T10:00:00.000Z"),
      endAt: new Date("2026-09-10T11:00:00.000Z"),
      type: "MEETING",
    });

    const updated = await calendarService.updateEvent(agentRdv.db, agentRdv.authUser, event.id, {
      type: "APPOINTMENT",
      callId: call.id,
      agentRdvId: agentRdv.user.id,
    });

    expect(updated.type).toBe("APPOINTMENT");
    expect(updated.status).toBe("EN_ATTENTE_DE_CONFIRMATION");
    expect(updated.callId).toBe(call.id);
    expect(updated.agentRdvId).toBe(agentRdv.user.id);

    const full = await calendarService.getEvent(agentRdv.db, agentRdv.authUser, event.id);
    expect(full.statusHistory.some((h) => h.newStatus === "EN_ATTENTE_DE_CONFIRMATION")).toBe(true);
  });

  it("§P0.5 : devenir Rendez-vous respecte l'unicité de RDV actif par appel", async () => {
    await ensurePermissionsSeeded();
    const { agentRdv, calendar, call } = await setupWithCall("Org TypeChange Call Conflict");
    await calendarService.createEvent(agentRdv.db, agentRdv.authUser, {
      calendarId: calendar.id,
      title: "RDV déjà pris",
      startAt: new Date("2026-09-10T08:00:00.000Z"),
      endAt: new Date("2026-09-10T09:00:00.000Z"),
      type: "APPOINTMENT",
      callId: call.id,
    });

    const meeting = await calendarService.createEvent(agentRdv.db, agentRdv.authUser, {
      calendarId: calendar.id,
      title: "Réunion",
      startAt: new Date("2026-09-10T10:00:00.000Z"),
      endAt: new Date("2026-09-10T11:00:00.000Z"),
      type: "MEETING",
    });

    await expect(
      calendarService.updateEvent(agentRdv.db, agentRdv.authUser, meeting.id, { type: "APPOINTMENT", callId: call.id }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("§P0.5 : devenir Rendez-vous respecte l'absence de chevauchement pour l'agent RDV", async () => {
    await ensurePermissionsSeeded();
    const { org, agentRdv, calendar, call } = await setupWithCall("Org TypeChange Overlap");
    const call2 = await createTestCall(agentRdv.db, org, agentRdv.user, "+33611111112");
    await calendarService.createEvent(agentRdv.db, agentRdv.authUser, {
      calendarId: calendar.id,
      title: "RDV existant",
      startAt: new Date("2026-09-10T10:00:00.000Z"),
      endAt: new Date("2026-09-10T11:00:00.000Z"),
      type: "APPOINTMENT",
      callId: call.id,
      agentRdvId: agentRdv.user.id,
    });

    const meeting = await calendarService.createEvent(agentRdv.db, agentRdv.authUser, {
      calendarId: calendar.id,
      title: "Réunion en même temps",
      startAt: new Date("2026-09-10T10:30:00.000Z"),
      endAt: new Date("2026-09-10T11:30:00.000Z"),
      type: "MEETING",
    });

    await expect(
      calendarService.updateEvent(agentRdv.db, agentRdv.authUser, meeting.id, {
        type: "APPOINTMENT",
        callId: call2.id,
        agentRdvId: agentRdv.user.id,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("quitter le type Rendez-vous efface le statut et l'agent RDV, sans toucher au reste", async () => {
    await ensurePermissionsSeeded();
    const { agentRdv, calendar, call } = await setupWithCall("Org TypeChange Leave Appointment");
    const event = await calendarService.createEvent(agentRdv.db, agentRdv.authUser, {
      calendarId: calendar.id,
      title: "RDV",
      startAt: new Date("2026-09-10T10:00:00.000Z"),
      endAt: new Date("2026-09-10T11:00:00.000Z"),
      type: "APPOINTMENT",
      callId: call.id,
      agentRdvId: agentRdv.user.id,
    });

    const updated = await calendarService.updateEvent(agentRdv.db, agentRdv.authUser, event.id, { type: "PERSONAL" });

    expect(updated.type).toBe("PERSONAL");
    expect(updated.status).toBeNull();
    expect(updated.agentRdvId).toBeNull();
    expect(updated.title).toBe("RDV");
  });

  it("changer entre deux types non-Rendez-vous fonctionne sans aucune vérification d'invariant", async () => {
    await ensurePermissionsSeeded();
    const { agentRdv, calendar } = await setupWithCall("Org TypeChange Simple");
    const event = await calendarService.createEvent(agentRdv.db, agentRdv.authUser, {
      calendarId: calendar.id,
      title: "Réunion",
      startAt: new Date("2026-09-10T10:00:00.000Z"),
      endAt: new Date("2026-09-10T11:00:00.000Z"),
      type: "MEETING",
    });

    const updated = await calendarService.updateEvent(agentRdv.db, agentRdv.authUser, event.id, { type: "PERSONAL" });
    expect(updated.type).toBe("PERSONAL");
  });
});
