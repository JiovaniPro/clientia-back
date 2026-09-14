import { describe, expect, it } from "vitest";
import * as calendarService from "../src/modules/calendar/service.js";
import * as clientsService from "../src/modules/clients/service.js";
import * as reportsService from "../src/modules/reports/service.js";
import { createTestOrganization, createTestUser, ensurePermissionsSeeded } from "./helpers.js";

/**
 * §5.15/§5.17 sous-lot 1 — ce module n'avait AUCUN test avant ce fichier. Ce
 * premier bloc capture le comportement RÉEL actuel (base de vérité), avant toute
 * extension (byDirection, taux de conversion, filtre userId) — voir les blocs
 * suivants pour les nouveautés. Dates calculées par rapport à `Date.now()` au
 * lancement des tests plutôt que codées en dur (leçon tirée des 3 fichiers de
 * tests calendrier déjà cassés ailleurs par des dates absolues désormais dans le passé).
 */
const NOW = new Date();
const inDays = (days: number) => new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000);
const inHours = (hours: number) => new Date(NOW.getTime() + hours * 60 * 60 * 1000);

async function createTestCall(
  db: Awaited<ReturnType<typeof createTestUser>>["db"],
  orgId: string,
  userId: string,
  statusId: string,
  occurredAt: Date,
  overrides: Partial<{ direction: "INBOUND" | "OUTBOUND"; type: "PROSPECTION" | "SUPPORT" | "FOLLOW_UP" | "OTHER" }> = {},
) {
  return db.call.create({
    data: {
      organizationId: orgId,
      userId,
      direction: overrides.direction ?? "OUTBOUND",
      type: overrides.type ?? "PROSPECTION",
      statusId,
      fromNumber: "+33600000000",
      toNumber: `+336${Math.floor(Math.random() * 100000000)}`,
      occurredAt,
    },
  });
}

describe("GET /reports/calls — comportement actuel (base de vérité)", () => {
  it("compte, groupe par statut/type/agent, uniquement dans la plage [from, to]", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Reports Calls");
    const admin = await createTestUser(org.id, "Administrateur");
    const calliste = await createTestUser(org.id, "Agent calliste");
    const contacterStatus = await admin.db.configurableListItem.findFirstOrThrow({
      where: { listKey: "CALL_STATUS", key: "A_CONTACTER" },
    });
    const rdvPrisStatus = await admin.db.configurableListItem.findFirstOrThrow({
      where: { listKey: "CALL_STATUS", key: "RDV_PRIS" },
    });

    // 2 dans la plage (statuts et agents différents), 1 hors plage.
    await createTestCall(admin.db, org.id, admin.user.id, contacterStatus.id, inHours(1), { type: "PROSPECTION" });
    await createTestCall(admin.db, org.id, calliste.user.id, rdvPrisStatus.id, inHours(2), { type: "SUPPORT" });
    await createTestCall(admin.db, org.id, admin.user.id, contacterStatus.id, inDays(30)); // hors plage

    const report = await reportsService.getCallsReport(admin.db, admin.authUser, { from: inHours(0), to: inHours(3) });

    expect(report.total).toBe(2);
    expect(report.byStatus.sort((a, b) => a.count - b.count)).toEqual(
      [
        { statusId: contacterStatus.id, label: "À contacter", count: 1 },
        { statusId: rdvPrisStatus.id, label: "RDV pris", count: 1 },
      ].sort((a, b) => a.count - b.count),
    );
    expect(report.byType.map((t) => t.type).sort()).toEqual(["PROSPECTION", "SUPPORT"]);
    expect(report.byUser).toHaveLength(2);
    const adminEntry = report.byUser.find((u) => u.userId === admin.user.id);
    expect(adminEntry?.count).toBe(1);
    expect(adminEntry?.user).toMatchObject({ id: admin.user.id });
  });

  it("les bornes from/to sont inclusives (gte/lte) — confirmé, pas supposé", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Reports Calls Bounds");
    const admin = await createTestUser(org.id, "Administrateur");
    const status = await admin.db.configurableListItem.findFirstOrThrow({
      where: { listKey: "CALL_STATUS", isDefault: true },
    });

    const from = inHours(0);
    const to = inHours(5);
    await createTestCall(admin.db, org.id, admin.user.id, status.id, from); // exactement sur la borne from
    await createTestCall(admin.db, org.id, admin.user.id, status.id, to); // exactement sur la borne to

    const report = await reportsService.getCallsReport(admin.db, admin.authUser, { from, to });
    expect(report.total).toBe(2);
  });

  it("isolation multi-tenant : n'inclut jamais les appels d'une autre organisation", async () => {
    await ensurePermissionsSeeded();
    const orgA = await createTestOrganization("Org Reports Isolation A");
    const orgB = await createTestOrganization("Org Reports Isolation B");
    const adminA = await createTestUser(orgA.id, "Administrateur");
    const adminB = await createTestUser(orgB.id, "Administrateur");
    const statusA = await adminA.db.configurableListItem.findFirstOrThrow({
      where: { listKey: "CALL_STATUS", isDefault: true },
    });
    const statusB = await adminB.db.configurableListItem.findFirstOrThrow({
      where: { listKey: "CALL_STATUS", isDefault: true },
    });
    await createTestCall(adminA.db, orgA.id, adminA.user.id, statusA.id, inHours(1));
    await createTestCall(adminB.db, orgB.id, adminB.user.id, statusB.id, inHours(1));

    const reportA = await reportsService.getCallsReport(adminA.db, adminA.authUser, { from: inHours(0), to: inHours(2) });
    expect(reportA.total).toBe(1);
  });
});

describe("GET /reports/clients — comportement actuel (base de vérité)", () => {
  async function createTestClientWithFinalStatus(
    user: Awaited<ReturnType<typeof createTestUser>>,
    orgId: string,
    finalStatusKey: string,
  ) {
    const status = await user.db.configurableListItem.findFirstOrThrow({
      where: { listKey: "CALL_STATUS", isDefault: true },
    });
    const call = await user.db.call.create({
      data: {
        organizationId: orgId,
        userId: user.user.id,
        direction: "OUTBOUND",
        type: "PROSPECTION",
        statusId: status.id,
        fromNumber: "+33600000000",
        toNumber: `+336${Math.floor(Math.random() * 100000000)}`,
        occurredAt: inHours(1),
      },
    });
    const country = await user.db.configurableListItem.findFirstOrThrow({ where: { listKey: "CLIENT_COUNTRY" } });
    return clientsService.createClient(user.db, user.authUser, {
      callId: call.id,
      agentId: user.user.id,
      phoneNumber: `+336${Math.floor(Math.random() * 100000000)}`,
      countryKey: country.key,
      finalStatusKey,
    });
  }

  it("compte et groupe par statut de dossier et statut final, dans la plage [from, to] sur createdAt", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Reports Clients");
    const admin = await createTestUser(org.id, "Administrateur");

    await createTestClientWithFinalStatus(admin, org.id, "DOSSIER_VALIDE");
    await createTestClientWithFinalStatus(admin, org.id, "SANS_SUITE");

    const report = await reportsService.getClientsReport(admin.db, { from: inHours(-1), to: inHours(1) });

    expect(report.total).toBe(2);
    const finalLabels = report.byFinalStatus.map((s) => s.label).sort();
    expect(finalLabels).toEqual(["Dossier validé", "Sans suite"]);
    // Tous créés avec le statut de dossier par défaut ("Nouveau") — un seul groupe.
    expect(report.byDossierStatus).toHaveLength(1);
    expect(report.byDossierStatus[0]?.count).toBe(2);
  });

  it("exclut les dossiers créés hors de la plage [from, to]", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Reports Clients Range");
    const admin = await createTestUser(org.id, "Administrateur");
    await createTestClientWithFinalStatus(admin, org.id, "DOSSIER_VALIDE");

    // Plage qui ne couvre pas "maintenant" (le dossier vient d'être créé avec createdAt = now()).
    const report = await reportsService.getClientsReport(admin.db, { from: inDays(10), to: inDays(11) });
    expect(report.total).toBe(0);
  });
});

describe("GET /reports/appointments — comportement actuel (base de vérité)", () => {
  async function setupCalendar(orgName: string) {
    const org = await createTestOrganization(orgName);
    const agentRdv = await createTestUser(org.id, "Agent RDV");
    const calendar = await calendarService.createCalendar(agentRdv.db, agentRdv.authUser, {
      name: "Mon calendrier",
      color: "#1f6f54",
    });
    return { org, agentRdv, calendar };
  }

  async function createTestCallForAppointment(agentRdv: Awaited<ReturnType<typeof createTestUser>>, orgId: string) {
    const status = await agentRdv.db.configurableListItem.findFirstOrThrow({
      where: { listKey: "CALL_STATUS", isDefault: true },
    });
    return agentRdv.db.call.create({
      data: {
        organizationId: orgId,
        userId: agentRdv.user.id,
        direction: "OUTBOUND",
        type: "PROSPECTION",
        statusId: status.id,
        fromNumber: "+33600000000",
        toNumber: `+336${Math.floor(Math.random() * 100000000)}`,
        occurredAt: inHours(1),
      },
    });
  }

  it("compte et groupe par statut de RDV, restreint aux événements type=APPOINTMENT — vérifié explicitement", async () => {
    await ensurePermissionsSeeded();
    const { org, agentRdv, calendar } = await setupCalendar("Org Reports Appointments");
    const call1 = await createTestCallForAppointment(agentRdv, org.id);
    const call2 = await createTestCallForAppointment(agentRdv, org.id);

    await calendarService.createEvent(agentRdv.db, agentRdv.authUser, {
      calendarId: calendar.id,
      title: "RDV 1",
      startAt: inDays(1),
      endAt: inDays(1),
      type: "APPOINTMENT",
      callId: call1.id,
      agentRdvId: agentRdv.user.id,
    });
    await calendarService.createEvent(agentRdv.db, agentRdv.authUser, {
      calendarId: calendar.id,
      title: "RDV 2",
      startAt: inDays(2),
      endAt: inDays(2),
      type: "APPOINTMENT",
      callId: call2.id,
      agentRdvId: agentRdv.user.id,
    });
    // Un événement NON-RDV dans la même plage de dates — doit être exclu du total.
    await calendarService.createEvent(agentRdv.db, agentRdv.authUser, {
      calendarId: calendar.id,
      title: "Réunion d'équipe",
      startAt: inDays(1),
      endAt: inDays(1),
      type: "MEETING",
    });

    const report = await reportsService.getAppointmentsReport(agentRdv.db, agentRdv.authUser, { from: inDays(0), to: inDays(3) });

    expect(report.total).toBe(2); // les 2 RDV, pas la réunion
    expect(report.byStatus).toEqual([{ status: "EN_ATTENTE_DE_CONFIRMATION", count: 2 }]);
  });

  it("exclut les RDV hors de la plage [from, to] sur startAt", async () => {
    await ensurePermissionsSeeded();
    const { org, agentRdv, calendar } = await setupCalendar("Org Reports Appointments Range");
    const call = await createTestCallForAppointment(agentRdv, org.id);

    await calendarService.createEvent(agentRdv.db, agentRdv.authUser, {
      calendarId: calendar.id,
      title: "RDV lointain",
      startAt: inDays(60),
      endAt: inDays(60),
      type: "APPOINTMENT",
      callId: call.id,
      agentRdvId: agentRdv.user.id,
    });

    const report = await reportsService.getAppointmentsReport(agentRdv.db, agentRdv.authUser, { from: inDays(0), to: inDays(3) });
    expect(report.total).toBe(0);
  });
});

describe("§5.15 — nouveautés : répartition par direction et taux de conversion", () => {
  it("byDirection groupe correctement INBOUND/OUTBOUND", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Reports Direction");
    const admin = await createTestUser(org.id, "Administrateur");
    const status = await admin.db.configurableListItem.findFirstOrThrow({
      where: { listKey: "CALL_STATUS", isDefault: true },
    });
    await createTestCall(admin.db, org.id, admin.user.id, status.id, inHours(1), { direction: "OUTBOUND" });
    await createTestCall(admin.db, org.id, admin.user.id, status.id, inHours(1), { direction: "OUTBOUND" });
    await createTestCall(admin.db, org.id, admin.user.id, status.id, inHours(1), { direction: "INBOUND" });

    const report = await reportsService.getCallsReport(admin.db, admin.authUser, { from: inHours(0), to: inHours(2) });

    expect(report.byDirection.sort((a, b) => a.direction.localeCompare(b.direction))).toEqual([
      { direction: "INBOUND", count: 1 },
      { direction: "OUTBOUND", count: 2 },
    ]);
  });

  it("le taux de conversion se base sur metadata.triggersClientDossierCreation, pas sur une approximation temporelle", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Reports Conversion");
    const admin = await createTestUser(org.id, "Administrateur");
    // "RDV_PRIS" porte metadata.triggersClientDossierCreation:true par défaut (voir defaultData.ts).
    const rdvPris = await admin.db.configurableListItem.findFirstOrThrow({
      where: { listKey: "CALL_STATUS", key: "RDV_PRIS" },
    });
    const aContacter = await admin.db.configurableListItem.findFirstOrThrow({
      where: { listKey: "CALL_STATUS", key: "A_CONTACTER" },
    });
    await createTestCall(admin.db, org.id, admin.user.id, rdvPris.id, inHours(1));
    await createTestCall(admin.db, org.id, admin.user.id, aContacter.id, inHours(1));
    await createTestCall(admin.db, org.id, admin.user.id, aContacter.id, inHours(1));

    const report = await reportsService.getCallsReport(admin.db, admin.authUser, { from: inHours(0), to: inHours(2) });

    expect(report.total).toBe(3);
    expect(report.conversion).toEqual({ triggeringCount: 1, rate: 1 / 3 });
  });

  it("le taux de conversion est 0 sans appels sur la période (pas de division par zéro)", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Reports Conversion Empty");
    const admin = await createTestUser(org.id, "Administrateur");

    const report = await reportsService.getCallsReport(admin.db, admin.authUser, { from: inHours(0), to: inHours(2) });

    expect(report.conversion).toEqual({ triggeringCount: 0, rate: 0 });
  });
});

describe("§5.17 — portée reports.view vs reports.viewAll", () => {
  it("un agent sans reports.viewAll ne voit que ses propres appels, même en demandant un autre userId", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Reports Scope Calls");
    const calliste = await createTestUser(org.id, "Agent calliste");
    const otherCalliste = await createTestUser(org.id, "Agent calliste");
    const status = await calliste.db.configurableListItem.findFirstOrThrow({
      where: { listKey: "CALL_STATUS", isDefault: true },
    });
    await createTestCall(calliste.db, org.id, calliste.user.id, status.id, inHours(1));
    await createTestCall(calliste.db, org.id, otherCalliste.user.id, status.id, inHours(1));

    expect(calliste.authUser.permissions).not.toContain("reports.viewAll");

    // Même en essayant de demander explicitement les appels de l'autre agent, il
    // reste ramené aux siens — la portée est décidée côté service, pas côté client.
    const report = await reportsService.getCallsReport(calliste.db, calliste.authUser, {
      from: inHours(0),
      to: inHours(2),
      userId: otherCalliste.user.id,
    });

    expect(report.total).toBe(1);
    expect(report.byUser).toEqual([{ userId: calliste.user.id, user: expect.anything(), count: 1 }]);
  });

  it("un admin (reports.viewAll) voit tout par défaut, et peut filtrer sur un agent précis", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Reports Scope Admin");
    const admin = await createTestUser(org.id, "Administrateur");
    const calliste = await createTestUser(org.id, "Agent calliste");
    const status = await admin.db.configurableListItem.findFirstOrThrow({
      where: { listKey: "CALL_STATUS", isDefault: true },
    });
    await createTestCall(admin.db, org.id, admin.user.id, status.id, inHours(1));
    await createTestCall(admin.db, org.id, calliste.user.id, status.id, inHours(1));

    expect(admin.authUser.permissions).toContain("reports.viewAll");

    const globalReport = await reportsService.getCallsReport(admin.db, admin.authUser, {
      from: inHours(0),
      to: inHours(2),
    });
    expect(globalReport.total).toBe(2);

    const filteredReport = await reportsService.getCallsReport(admin.db, admin.authUser, {
      from: inHours(0),
      to: inHours(2),
      userId: calliste.user.id,
    });
    expect(filteredReport.total).toBe(1);
  });

  it("même portée appliquée au rapport de rendez-vous, sur agentRdvId", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Reports Scope Appointments");
    const agentRdvA = await createTestUser(org.id, "Agent RDV");
    const agentRdvB = await createTestUser(org.id, "Agent RDV");
    const calendar = await calendarService.createCalendar(agentRdvA.db, agentRdvA.authUser, {
      name: "Calendrier A",
      color: "#1f6f54",
    });
    const callStatus = await agentRdvA.db.configurableListItem.findFirstOrThrow({
      where: { listKey: "CALL_STATUS", isDefault: true },
    });
    const callForA = await agentRdvA.db.call.create({
      data: {
        organizationId: org.id,
        userId: agentRdvA.user.id,
        direction: "OUTBOUND",
        type: "PROSPECTION",
        statusId: callStatus.id,
        fromNumber: "+33600000000",
        toNumber: "+33600000001",
        occurredAt: inHours(1),
      },
    });
    const callForB = await agentRdvA.db.call.create({
      data: {
        organizationId: org.id,
        userId: agentRdvB.user.id,
        direction: "OUTBOUND",
        type: "PROSPECTION",
        statusId: callStatus.id,
        fromNumber: "+33600000000",
        toNumber: "+33600000002",
        occurredAt: inHours(1),
      },
    });
    await calendarService.createEvent(agentRdvA.db, agentRdvA.authUser, {
      calendarId: calendar.id,
      title: "RDV agent A",
      startAt: inDays(1),
      endAt: inDays(1),
      type: "APPOINTMENT",
      callId: callForA.id,
      agentRdvId: agentRdvA.user.id,
    });
    await calendarService.createEvent(agentRdvA.db, agentRdvA.authUser, {
      calendarId: calendar.id,
      title: "RDV agent B",
      startAt: inDays(1),
      endAt: inDays(1),
      type: "APPOINTMENT",
      callId: callForB.id,
      agentRdvId: agentRdvB.user.id,
    });

    expect(agentRdvA.authUser.permissions).not.toContain("reports.viewAll");

    const report = await reportsService.getAppointmentsReport(agentRdvA.db, agentRdvA.authUser, {
      from: inDays(0),
      to: inDays(2),
      userId: agentRdvB.user.id, // tentative d'accéder aux RDV de B — doit être ignorée
    });

    expect(report.total).toBe(1); // seulement le RDV de A
  });
});
