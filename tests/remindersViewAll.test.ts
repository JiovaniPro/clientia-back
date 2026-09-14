import { describe, expect, it } from "vitest";
import * as remindersService from "../src/modules/reminders/service.js";
import { createTestOrganization, createTestUser, ensurePermissionsSeeded } from "./helpers.js";

/**
 * §5.19 — `reminders.viewAll` doit permettre la supervision des rappels liés à un
 * appel/client, mais JAMAIS exposer les pense-bêtes personnels (callId: null) d'un
 * autre utilisateur — même en vue globale (sans filtre agent), même en forçant
 * explicitement l'id de quelqu'un d'autre. La garantie doit être structurelle,
 * testée sous tous les angles où elle pourrait fuiter.
 */
describe("§5.19 — reminders.viewAll, exclusion structurelle des rappels personnels", () => {
  it("sans reminders.viewAll, ne voit que ses propres rappels (personnels et liés), même en demandant un autre userId", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Reminders ViewAll Scope");
    const calliste = await createTestUser(org.id, "Agent calliste");
    const other = await createTestUser(org.id, "Agent calliste");
    const ownPersonal = await remindersService.createReminder(calliste.db, calliste.authUser, {
      title: "Perso à moi",
      dueAt: new Date(Date.now() + 3600_000),
    });
    await remindersService.createReminder(other.db, other.authUser, {
      title: "Perso à l'autre",
      dueAt: new Date(Date.now() + 3600_000),
    });

    expect(calliste.authUser.permissions).not.toContain("reminders.viewAll");

    const result = await remindersService.listReminders(calliste.db, calliste.authUser, { userId: other.user.id });

    expect(result.map((r) => r.id)).toEqual([ownPersonal.id]);
  });

  it("avec reminders.viewAll, la vue globale (sans filtre) inclut ses propres rappels personnels + les rappels LIÉS de tous, jamais les personnels des autres", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Reminders ViewAll Global");
    const admin = await createTestUser(org.id, "Administrateur");
    const calliste = await createTestUser(org.id, "Agent calliste");

    const call = await calliste.db.call.create({
      data: {
        organizationId: org.id,
        userId: calliste.user.id,
        direction: "OUTBOUND",
        type: "PROSPECTION",
        statusId: (
          await calliste.db.configurableListItem.findFirstOrThrow({ where: { listKey: "CALL_STATUS", isDefault: true } })
        ).id,
        fromNumber: "+33600000000",
        toNumber: "+33600000099",
        occurredAt: new Date(),
      },
    });

    const adminPersonal = await remindersService.createReminder(admin.db, admin.authUser, {
      title: "Pense-bête perso admin",
      dueAt: new Date(Date.now() + 3600_000),
    });
    const callisteLinked = await remindersService.createReminder(calliste.db, calliste.authUser, {
      callId: call.id,
      title: "Relance liée à un appel",
      dueAt: new Date(Date.now() + 3600_000),
    });
    const callistePersonal = await remindersService.createReminder(calliste.db, calliste.authUser, {
      title: "Pense-bête perso de Camille",
      dueAt: new Date(Date.now() + 3600_000),
    });

    expect(admin.authUser.permissions).toContain("reminders.viewAll");

    const globalView = await remindersService.listReminders(admin.db, admin.authUser, {});
    const ids = globalView.map((r) => r.id);

    expect(ids).toContain(adminPersonal.id); // le sien, personnel — visible
    expect(ids).toContain(callisteLinked.id); // lié à un appel, d'un autre — visible
    expect(ids).not.toContain(callistePersonal.id); // personnel, d'un autre — JAMAIS visible
  });

  it("même en filtrant explicitement sur un autre agent précis, ses rappels personnels restent exclus", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Reminders ViewAll Filtered");
    const admin = await createTestUser(org.id, "Administrateur");
    const calliste = await createTestUser(org.id, "Agent calliste");

    const call = await calliste.db.call.create({
      data: {
        organizationId: org.id,
        userId: calliste.user.id,
        direction: "OUTBOUND",
        type: "PROSPECTION",
        statusId: (
          await calliste.db.configurableListItem.findFirstOrThrow({ where: { listKey: "CALL_STATUS", isDefault: true } })
        ).id,
        fromNumber: "+33600000000",
        toNumber: "+33600000098",
        occurredAt: new Date(),
      },
    });
    const linked = await remindersService.createReminder(calliste.db, calliste.authUser, {
      callId: call.id,
      title: "Relance liée",
      dueAt: new Date(Date.now() + 3600_000),
    });
    const personal = await remindersService.createReminder(calliste.db, calliste.authUser, {
      title: "Perso de Camille",
      dueAt: new Date(Date.now() + 3600_000),
    });

    const filtered = await remindersService.listReminders(admin.db, admin.authUser, { userId: calliste.user.id });
    const ids = filtered.map((r) => r.id);

    expect(ids).toEqual([linked.id]);
    expect(ids).not.toContain(personal.id);
  });

  it("un admin filtrant explicitement sur lui-même voit bien ses propres rappels personnels", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Reminders ViewAll Self");
    const admin = await createTestUser(org.id, "Administrateur");
    const personal = await remindersService.createReminder(admin.db, admin.authUser, {
      title: "Perso admin",
      dueAt: new Date(Date.now() + 3600_000),
    });

    const result = await remindersService.listReminders(admin.db, admin.authUser, { userId: admin.user.id });
    expect(result.map((r) => r.id)).toContain(personal.id);
  });

  it("update/delete sur le rappel personnel d'un autre reste refusé même avec reminders.viewAll (lecture seule, non étendu)", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Reminders ViewAll Write");
    const admin = await createTestUser(org.id, "Administrateur");
    const calliste = await createTestUser(org.id, "Agent calliste");
    const reminder = await remindersService.createReminder(calliste.db, calliste.authUser, {
      title: "Pas touche",
      dueAt: new Date(Date.now() + 3600_000),
    });

    await expect(
      remindersService.updateReminder(admin.db, admin.authUser, reminder.id, { status: "DONE" }),
    ).rejects.toThrow();
    await expect(remindersService.deleteReminder(admin.db, admin.authUser, reminder.id)).rejects.toThrow();
  });
});
