import { beforeAll, describe, expect, it } from "vitest";
import * as remindersService from "../src/modules/reminders/service.js";
import { createTestOrganization, createTestUser, ensurePermissionsSeeded } from "./helpers.js";

/**
 * Les rappels sont scopés au créateur (voir modules/reminders/service.ts) — une
 * portée différente et plus étroite que l'isolation multi-tenant générique déjà
 * couverte par tenantIsolation.test.ts : ici on vérifie que deux utilisateurs de LA
 * MÊME organisation ne voient jamais les rappels l'un de l'autre, pas seulement
 * qu'une organisation ne voit pas celle d'une autre.
 */
describe("rappels — scoping au créateur", () => {
  let calliste: Awaited<ReturnType<typeof createTestUser>>;
  let agentRdv: Awaited<ReturnType<typeof createTestUser>>;

  beforeAll(async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Reminders");
    calliste = await createTestUser(org.id, "Agent calliste");
    agentRdv = await createTestUser(org.id, "Agent RDV");
  });

  it("chaque utilisateur ne voit que ses propres rappels, même dans la même organisation", async () => {
    const own = await remindersService.createReminder(calliste.db, calliste.authUser, {
      title: "Rappeler M. Martin",
      dueAt: new Date(Date.now() + 3600_000),
    });
    await remindersService.createReminder(agentRdv.db, agentRdv.authUser, {
      title: "Rappel de Robin",
      dueAt: new Date(Date.now() + 3600_000),
    });

    const listedByCalliste = await remindersService.listReminders(calliste.db, calliste.authUser, {});
    expect(listedByCalliste.map((r) => r.id)).toContain(own.id);
    expect(listedByCalliste.every((r) => r.title !== "Rappel de Robin")).toBe(true);
  });

  it("update/delete sur le rappel d'un autre utilisateur échoue (NotFound), même même organisation", async () => {
    const reminder = await remindersService.createReminder(calliste.db, calliste.authUser, {
      title: "Confidentiel à Camille",
      dueAt: new Date(Date.now() + 3600_000),
    });

    await expect(
      remindersService.updateReminder(agentRdv.db, agentRdv.authUser, reminder.id, { status: "DONE" }),
    ).rejects.toThrow();
    await expect(remindersService.deleteReminder(agentRdv.db, agentRdv.authUser, reminder.id)).rejects.toThrow();

    const stillThere = await remindersService.listReminders(calliste.db, calliste.authUser, {});
    expect(stillThere.some((r) => r.id === reminder.id && r.status === "PENDING")).toBe(true);
  });

  /**
   * Gap trouvé au lot 5, corrigé sur demande explicite de l'utilisateur : "Agent
   * RDV" n'avait par défaut que `reminders.create`, jamais `reminders.update` ni
   * `reminders.delete` (lib/defaultRoles.ts) — un Agent RDV pouvait donc créer un
   * rappel pour lui-même mais ne jamais le marquer fait ni le supprimer, nulle part.
   * Rien dans le cahier des charges ne justifiait cette restriction : oubli de
   * configuration du rôle système, pas une règle métier voulue. Corrigé en ajoutant
   * les deux clés au rôle "Agent RDV" par défaut.
   */
  it("un Agent RDV peut désormais marquer fait et supprimer un rappel qu'il a créé", async () => {
    expect(agentRdv.authUser.permissions).toContain("reminders.update");
    expect(agentRdv.authUser.permissions).toContain("reminders.delete");

    const reminder = await remindersService.createReminder(agentRdv.db, agentRdv.authUser, {
      title: "Rappel de Robin à traiter lui-même",
      dueAt: new Date(Date.now() + 3600_000),
    });

    const marked = await remindersService.updateReminder(agentRdv.db, agentRdv.authUser, reminder.id, {
      status: "DONE",
    });
    expect(marked.status).toBe("DONE");

    await remindersService.deleteReminder(agentRdv.db, agentRdv.authUser, reminder.id);
    const afterDelete = await remindersService.listReminders(agentRdv.db, agentRdv.authUser, {});
    expect(afterDelete.some((r) => r.id === reminder.id)).toBe(false);
  });

  it("le filtre status ne renvoie que les rappels du statut demandé, toujours scopés au créateur", async () => {
    const toDone = await remindersService.createReminder(calliste.db, calliste.authUser, {
      title: "À marquer fait",
      dueAt: new Date(Date.now() + 3600_000),
    });
    await remindersService.updateReminder(calliste.db, calliste.authUser, toDone.id, { status: "DONE" });

    const doneOnly = await remindersService.listReminders(calliste.db, calliste.authUser, { status: "DONE" });
    expect(doneOnly.every((r) => r.status === "DONE")).toBe(true);
    expect(doneOnly.some((r) => r.id === toDone.id)).toBe(true);
  });
});
