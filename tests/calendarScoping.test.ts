import { beforeAll, describe, expect, it } from "vitest";
import * as calendarService from "../src/modules/calendar/service.js";
import { createTestOrganization, createTestUser, ensurePermissionsSeeded } from "./helpers.js";

/**
 * Gap trouvé au sous-lot A du Calendrier Pro (§5.14) : `listEvents` acceptait un
 * paramètre `user` jamais utilisé (`_user`) — tout utilisateur avec `calendar.view`
 * seul (pas `calendar.viewAll`) recevait TOUS les événements de l'organisation.
 * `getEvent` n'acceptait même pas `user`. `updateEvent`/`deleteEvent`/
 * `changeAppointmentStatus` n'avaient aucune vérification de propriété. Corrigé
 * dans modules/calendar/service.ts avant de connecter ces routes au frontend.
 */
describe("calendrier — portée par utilisateur (lecture et écriture)", () => {
  let admin: Awaited<ReturnType<typeof createTestUser>>;
  let userA: Awaited<ReturnType<typeof createTestUser>>;
  let userB: Awaited<ReturnType<typeof createTestUser>>;
  let calendarA: string;
  let globalCalendar: string;

  beforeAll(async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Calendar Scoping");
    admin = await createTestUser(org.id, "Administrateur");
    userA = await createTestUser(org.id, "Agent calliste");
    userB = await createTestUser(org.id, "Agent calliste");

    const cal = await calendarService.createCalendar(userA.db, userA.authUser, {
      name: `Calendrier A ${Date.now()}`,
      color: "#000000",
    });
    calendarA = cal.id;

    const global = await calendarService.createCalendar(admin.db, admin.authUser, {
      name: `Calendrier global ${Date.now()}`,
      color: "#111111",
    });
    globalCalendar = global.id;
    await admin.db.calendar.update({ where: { id: globalCalendar }, data: { isGlobal: true } });
  });

  /**
   * Cas explicite demandé en revue : B n'est ni organisateur, ni agent RDV assigné,
   * ni participant, sur un événement PUBLIC (isPrivate: false passé explicitement,
   * pas laissé au défaut) d'un calendrier qui n'est ni le sien ni global. D'après la
   * règle de `eventAccessFilter`, B ne doit le voir dans aucun des deux cas.
   */
  it("un utilisateur sans calendar.viewAll ne voit pas l'événement PUBLIC d'un autre sur un calendrier qui n'est ni le sien ni global", async () => {
    const event = await calendarService.createEvent(userA.db, userA.authUser, {
      calendarId: calendarA,
      title: "Événement public de A, calendrier non partagé",
      type: "PERSONAL",
      startAt: new Date(Date.now() + 3_600_000),
      endAt: new Date(Date.now() + 7_200_000),
      isPrivate: false,
    });

    const from = new Date(Date.now());
    const to = new Date(Date.now() + 30 * 24 * 3_600_000);

    const seenByB = await calendarService.listEvents(userB.db, userB.authUser, { from, to });
    expect(seenByB.some((e) => e.id === event.id)).toBe(false);

    const seenByA = await calendarService.listEvents(userA.db, userA.authUser, { from, to });
    expect(seenByA.some((e) => e.id === event.id)).toBe(true);

    await expect(calendarService.getEvent(userB.db, userB.authUser, event.id)).rejects.toThrow();
    await expect(calendarService.getEvent(userA.db, userA.authUser, event.id)).resolves.toMatchObject({ id: event.id });
  });

  it("un admin avec calendar.viewAll voit l'événement de n'importe qui", async () => {
    const event = await calendarService.createEvent(userA.db, userA.authUser, {
      calendarId: calendarA,
      title: "Visible par l'admin",
      type: "PERSONAL",
      startAt: new Date(Date.now() + 3_600_000),
      endAt: new Date(Date.now() + 7_200_000),
    });

    const from = new Date(Date.now());
    const to = new Date(Date.now() + 30 * 24 * 3_600_000);
    const seenByAdmin = await calendarService.listEvents(admin.db, admin.authUser, { from, to });
    expect(seenByAdmin.some((e) => e.id === event.id)).toBe(true);
  });

  it("un événement sur un calendrier global est visible par tous, même sans calendar.viewAll", async () => {
    const event = await calendarService.createEvent(admin.db, admin.authUser, {
      calendarId: globalCalendar,
      title: "Réunion d'équipe",
      type: "MEETING",
      startAt: new Date(Date.now() + 3_600_000),
      endAt: new Date(Date.now() + 7_200_000),
    });

    const from = new Date(Date.now());
    const to = new Date(Date.now() + 30 * 24 * 3_600_000);
    const seenByB = await calendarService.listEvents(userB.db, userB.authUser, { from, to });
    expect(seenByB.some((e) => e.id === event.id)).toBe(true);
  });

  it("un événement isPrivate sur un calendrier global reste caché aux autres, même s'ils voient le calendrier", async () => {
    const event = await calendarService.createEvent(admin.db, admin.authUser, {
      calendarId: globalCalendar,
      title: "Confidentiel admin",
      type: "PERSONAL",
      startAt: new Date(Date.now() + 3_600_000),
      endAt: new Date(Date.now() + 7_200_000),
      isPrivate: true,
    });

    const from = new Date(Date.now());
    const to = new Date(Date.now() + 30 * 24 * 3_600_000);
    const seenByB = await calendarService.listEvents(userB.db, userB.authUser, { from, to });
    expect(seenByB.some((e) => e.id === event.id)).toBe(false);
  });

  it("modifier ou supprimer l'événement d'un autre échoue sans calendar.viewAll", async () => {
    const event = await calendarService.createEvent(userA.db, userA.authUser, {
      calendarId: calendarA,
      title: "À protéger",
      type: "PERSONAL",
      startAt: new Date(Date.now() + 3_600_000),
      endAt: new Date(Date.now() + 7_200_000),
    });

    await expect(
      calendarService.updateEvent(userB.db, userB.authUser, event.id, { title: "Piraté" }),
    ).rejects.toThrow();
    await expect(calendarService.deleteEvent(userB.db, userB.authUser, event.id)).rejects.toThrow();

    const stillThere = await calendarService.getEvent(userA.db, userA.authUser, event.id);
    expect(stillThere.title).toBe("À protéger");
  });

  it("l'agent RDV assigné à un rendez-vous peut le lire et changer son statut, même sans en être l'organisateur", async () => {
    const status = await userA.db.configurableListItem.findFirstOrThrow({ where: { listKey: "CALL_STATUS" } });
    const call = await userA.db.call.create({
      data: {
        organizationId: userA.authUser.organizationId,
        userId: userA.user.id,
        direction: "OUTBOUND",
        type: "PROSPECTION",
        statusId: status.id,
        fromNumber: "+33000000000",
        toNumber: "+33000000099",
        occurredAt: new Date(),
      },
    });

    const event = await calendarService.createEvent(userA.db, userA.authUser, {
      calendarId: calendarA,
      title: "RDV assigné à B",
      type: "APPOINTMENT",
      startAt: new Date(Date.now() + 3_600_000),
      endAt: new Date(Date.now() + 7_200_000),
      callId: call.id,
      agentRdvId: userB.user.id,
    });

    await expect(calendarService.getEvent(userB.db, userB.authUser, event.id)).resolves.toMatchObject({ id: event.id });

    const updated = await calendarService.changeAppointmentStatus(userB.db, userB.authUser, event.id, {
      status: "CONFIRME",
    });
    expect(updated.status).toBe("CONFIRME");
  });
});

/**
 * Gap trouvé au sous-lot A : ni "Agent calliste" ni "Agent RDV" n'avaient
 * `calendar.create` par défaut (lib/defaultRoles.ts). Comme aucun calendrier
 * personnel n'est auto-provisionné à la création d'un utilisateur, aucun des deux
 * rôles ne pouvait créer le moindre calendrier ni le moindre événement — seul
 * l'Administrateur le pouvait. Rien dans le cahier des charges ne réservait la
 * création d'événements à l'admin : oubli de configuration, pas une règle voulue.
 */
describe("calendrier — calendar.create accordé par défaut aux rôles agents", () => {
  it("Agent calliste et Agent RDV ont calendar.create et peuvent créer leur propre calendrier", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Calendar Create");
    const calliste = await createTestUser(org.id, "Agent calliste");
    const agentRdv = await createTestUser(org.id, "Agent RDV");

    expect(calliste.authUser.permissions).toContain("calendar.create");
    expect(agentRdv.authUser.permissions).toContain("calendar.create");

    const calendarByCalliste = await calendarService.createCalendar(calliste.db, calliste.authUser, {
      name: `Calendrier calliste ${Date.now()}`,
      color: "#8A6D3B",
    });
    expect(calendarByCalliste.id).toBeTruthy();

    const calendarByAgentRdv = await calendarService.createCalendar(agentRdv.db, agentRdv.authUser, {
      name: `Calendrier agent RDV ${Date.now()}`,
      color: "#3B6E8F",
    });
    expect(calendarByAgentRdv.id).toBeTruthy();
  });
});
