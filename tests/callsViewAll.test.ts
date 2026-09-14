import { describe, expect, it } from "vitest";
import * as callsService from "../src/modules/calls/service.js";
import { createTestOrganization, createTestUser, ensurePermissionsSeeded } from "./helpers.js";

async function createTestCall(user: Awaited<ReturnType<typeof createTestUser>>, orgId: string, overrideUserId?: string) {
  const status = await user.db.configurableListItem.findFirstOrThrow({
    where: { listKey: "CALL_STATUS", isDefault: true },
  });
  return user.db.call.create({
    data: {
      organizationId: orgId,
      userId: overrideUserId ?? user.user.id,
      direction: "OUTBOUND",
      type: "PROSPECTION",
      statusId: status.id,
      fromNumber: "+33600000000",
      toNumber: `+336${Math.floor(Math.random() * 100000000)}`,
      occurredAt: new Date(),
    },
  });
}

/**
 * §5.18 — Journal admin : `calls.viewAll` était déjà câblé (gate le scoping),
 * mais sans filtre par agent précis ni résolution du nom de l'agent dans la
 * réponse. Ce fichier couvre les deux ajouts de ce sous-lot.
 */
describe("§5.18 — listCalls : filtre userId et résolution de l'agent", () => {
  it("sans calls.viewAll, ne voit que ses propres appels, même en demandant un autre userId", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Calls ViewAll Scope");
    const calliste = await createTestUser(org.id, "Agent calliste");
    const otherCalliste = await createTestUser(org.id, "Agent calliste");
    await createTestCall(calliste, org.id);
    await createTestCall(calliste, org.id, otherCalliste.user.id);

    expect(calliste.authUser.permissions).not.toContain("calls.viewAll");

    const result = await callsService.listCalls(calliste.db, calliste.authUser, {
      userId: otherCalliste.user.id, // tentative d'accéder aux appels de l'autre — doit être ignorée
      sort: "recent",
      page: 1,
      pageSize: 25,
    });

    expect(result.total).toBe(1);
    expect(result.items[0]?.userId).toBe(calliste.user.id);
  });

  it("avec calls.viewAll, voit tout par défaut et peut filtrer sur un agent précis", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Calls ViewAll Admin");
    const admin = await createTestUser(org.id, "Administrateur");
    const calliste = await createTestUser(org.id, "Agent calliste");
    await createTestCall(admin, org.id);
    await createTestCall(admin, org.id, calliste.user.id);

    expect(admin.authUser.permissions).toContain("calls.viewAll");

    const globalResult = await callsService.listCalls(admin.db, admin.authUser, {
      sort: "recent",
      page: 1,
      pageSize: 25,
    });
    expect(globalResult.total).toBe(2);

    const filteredResult = await callsService.listCalls(admin.db, admin.authUser, {
      userId: calliste.user.id,
      sort: "recent",
      page: 1,
      pageSize: 25,
    });
    expect(filteredResult.total).toBe(1);
    expect(filteredResult.items[0]?.userId).toBe(calliste.user.id);
  });

  it("chaque appel renvoie le nom de l'agent, sans requête supplémentaire côté écran", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Calls Agent Name");
    const admin = await createTestUser(org.id, "Administrateur");
    await createTestCall(admin, org.id);

    const result = await callsService.listCalls(admin.db, admin.authUser, {
      sort: "recent",
      page: 1,
      pageSize: 25,
    });

    expect(result.items[0]?.user).toMatchObject({ id: admin.user.id, firstName: admin.user.firstName });
  });
});
