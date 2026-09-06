import { beforeAll, describe, expect, it } from "vitest";
import * as calendarService from "../src/modules/calendar/service.js";
import { createTestOrganization, createTestUser, ensurePermissionsSeeded } from "./helpers.js";

/**
 * Les deux invariants métier des rendez-vous actés dans le plan d'architecture (§5) :
 * un seul rendez-vous actif par appel, et pas de chevauchement actif pour un même
 * agent RDV. Vérifiés dans modules/calendar/service.ts avant toute écriture.
 */
describe("invariants métier des rendez-vous", () => {
  let organizer: Awaited<ReturnType<typeof createTestUser>>;
  let agentRdv: Awaited<ReturnType<typeof createTestUser>>;
  let calendarId: string;

  async function createCall(toNumber: string) {
    const status = await organizer.db.configurableListItem.findFirstOrThrow({ where: { listKey: "CALL_STATUS" } });
    return organizer.db.call.create({
      data: {
        organizationId: organizer.authUser.organizationId,
        userId: organizer.user.id,
        direction: "OUTBOUND",
        type: "PROSPECTION",
        statusId: status.id,
        fromNumber: "+33000000000",
        toNumber,
        occurredAt: new Date(),
      },
    });
  }

  beforeAll(async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Invariants");
    organizer = await createTestUser(org.id);
    agentRdv = await createTestUser(org.id);

    const calendar = await calendarService.createCalendar(organizer.db, organizer.authUser, {
      name: `Calendrier ${Date.now()}`,
      color: "#000000",
    });
    calendarId = calendar.id;
  });

  it("refuse un deuxième rendez-vous actif pour le même appel", async () => {
    const call = await createCall("+33000000001");

    await calendarService.createEvent(organizer.db, organizer.authUser, {
      calendarId,
      title: "RDV 1",
      type: "APPOINTMENT",
      startAt: new Date(Date.now() + 3_600_000),
      endAt: new Date(Date.now() + 7_200_000),
      callId: call.id,
    });

    await expect(
      calendarService.createEvent(organizer.db, organizer.authUser, {
        calendarId,
        title: "RDV 2 (même appel)",
        type: "APPOINTMENT",
        startAt: new Date(Date.now() + 10_800_000),
        endAt: new Date(Date.now() + 14_400_000),
        callId: call.id,
      }),
    ).rejects.toThrow();
  });

  it("refuse un chevauchement actif pour le même agent RDV", async () => {
    const start = new Date(Date.now() + 86_400_000);
    const end = new Date(start.getTime() + 3_600_000);

    const callA = await createCall("+33000000002");
    await calendarService.createEvent(organizer.db, organizer.authUser, {
      calendarId,
      title: "RDV agent A",
      type: "APPOINTMENT",
      startAt: start,
      endAt: end,
      callId: callA.id,
      agentRdvId: agentRdv.user.id,
    });

    const callB = await createCall("+33000000003");
    const overlappingStart = new Date(start.getTime() + 1_800_000); // chevauche de 30 min
    const overlappingEnd = new Date(overlappingStart.getTime() + 3_600_000);

    await expect(
      calendarService.createEvent(organizer.db, organizer.authUser, {
        calendarId,
        title: "RDV agent A (chevauche)",
        type: "APPOINTMENT",
        startAt: overlappingStart,
        endAt: overlappingEnd,
        callId: callB.id,
        agentRdvId: agentRdv.user.id,
      }),
    ).rejects.toThrow();
  });

  it("accepte un rendez-vous non chevauchant pour le même agent RDV", async () => {
    const start = new Date(Date.now() + 172_800_000);
    const end = new Date(start.getTime() + 3_600_000);
    const call = await createCall("+33000000004");

    const event = await calendarService.createEvent(organizer.db, organizer.authUser, {
      calendarId,
      title: "RDV agent A (isolé)",
      type: "APPOINTMENT",
      startAt: start,
      endAt: end,
      callId: call.id,
      agentRdvId: agentRdv.user.id,
    });

    expect(event.id).toBeTruthy();
  });
});
