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

describe("compteur disponible/occupé pour un agent RDV (point 5)", () => {
  it("busyCount à 0 sur un créneau libre", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Availability Free");
    const agentRdv = await createTestUser(org.id, "Agent RDV");

    const result = await calendarService.getAgentAvailability(
      agentRdv.db,
      agentRdv.user.id,
      new Date("2026-12-01T10:00:00.000Z"),
      new Date("2026-12-01T11:00:00.000Z"),
    );
    expect(result.busyCount).toBe(0);
  });

  it("busyCount à 1 quand l'agent a déjà un RDV actif qui chevauche le créneau", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Availability Busy");
    const agentRdv = await createTestUser(org.id, "Agent RDV");
    const calendar = await calendarService.createCalendar(agentRdv.db, agentRdv.authUser, {
      name: "Mon calendrier",
      color: "#1f6f54",
    });
    const call = await createTestCall(agentRdv.db, org, agentRdv.user, "+33611111111");
    const existing = await calendarService.createEvent(agentRdv.db, agentRdv.authUser, {
      calendarId: calendar.id,
      title: "RDV existant",
      startAt: new Date("2026-12-01T10:00:00.000Z"),
      endAt: new Date("2026-12-01T11:00:00.000Z"),
      type: "APPOINTMENT",
      callId: call.id,
      agentRdvId: agentRdv.user.id,
    });

    const overlapping = await calendarService.getAgentAvailability(
      agentRdv.db,
      agentRdv.user.id,
      new Date("2026-12-01T10:30:00.000Z"),
      new Date("2026-12-01T11:30:00.000Z"),
    );
    expect(overlapping.busyCount).toBe(1);

    // En édition (excludeEventId), le RDV ne se compte plus lui-même comme occupé.
    const editingSelf = await calendarService.getAgentAvailability(
      agentRdv.db,
      agentRdv.user.id,
      new Date("2026-12-01T10:00:00.000Z"),
      new Date("2026-12-01T11:00:00.000Z"),
      existing.id,
    );
    expect(editingSelf.busyCount).toBe(0);

    const free = await calendarService.getAgentAvailability(
      agentRdv.db,
      agentRdv.user.id,
      new Date("2026-12-01T12:00:00.000Z"),
      new Date("2026-12-01T13:00:00.000Z"),
    );
    expect(free.busyCount).toBe(0);
  });

  it("un RDV REFUSE/ANNULE ne compte pas comme occupé", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Availability Cancelled");
    const agentRdv = await createTestUser(org.id, "Agent RDV");
    const calendar = await calendarService.createCalendar(agentRdv.db, agentRdv.authUser, {
      name: "Mon calendrier",
      color: "#1f6f54",
    });
    const call = await createTestCall(agentRdv.db, org, agentRdv.user, "+33611111112");
    const event = await calendarService.createEvent(agentRdv.db, agentRdv.authUser, {
      calendarId: calendar.id,
      title: "RDV annulé",
      startAt: new Date("2026-12-02T10:00:00.000Z"),
      endAt: new Date("2026-12-02T11:00:00.000Z"),
      type: "APPOINTMENT",
      callId: call.id,
      agentRdvId: agentRdv.user.id,
    });
    await calendarService.changeAppointmentStatus(agentRdv.db, agentRdv.authUser, event.id, { status: "REFUSE" });

    const result = await calendarService.getAgentAvailability(
      agentRdv.db,
      agentRdv.user.id,
      new Date("2026-12-02T10:00:00.000Z"),
      new Date("2026-12-02T11:00:00.000Z"),
    );
    expect(result.busyCount).toBe(0);
  });

  it("ne renvoie que le compte, jamais les événements d'un autre agent que celui demandé (isolation basique)", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Availability Isolation");
    const agentA = await createTestUser(org.id, "Agent RDV");
    const agentB = await createTestUser(org.id, "Agent RDV");
    const calendar = await calendarService.createCalendar(agentA.db, agentA.authUser, {
      name: "Mon calendrier",
      color: "#1f6f54",
    });
    const call = await createTestCall(agentA.db, org, agentA.user, "+33611111113");
    await calendarService.createEvent(agentA.db, agentA.authUser, {
      calendarId: calendar.id,
      title: "RDV agent A",
      startAt: new Date("2026-12-03T10:00:00.000Z"),
      endAt: new Date("2026-12-03T11:00:00.000Z"),
      type: "APPOINTMENT",
      callId: call.id,
      agentRdvId: agentA.user.id,
    });

    const resultForB = await calendarService.getAgentAvailability(
      agentA.db,
      agentB.user.id,
      new Date("2026-12-03T10:00:00.000Z"),
      new Date("2026-12-03T11:00:00.000Z"),
    );
    expect(resultForB.busyCount).toBe(0);
  });
});
