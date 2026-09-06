import { beforeAll, describe, expect, it } from "vitest";
import { createTestOrganization, createTestUser, ensurePermissionsSeeded } from "./helpers.js";

/**
 * Condition de sortie explicite du plan d'architecture (§8, "Vérification") : aucune
 * requête faite via le client Prisma scopé d'une organisation — y compris avec un ID
 * deviné/exact d'une autre organisation — ne doit jamais lire, modifier ou supprimer
 * une ligne appartenant à une autre organisation. Voir src/db/scopedClient.ts.
 */
describe("étanchéité multi-tenant (client Prisma scopé)", () => {
  let orgAId: string;
  let orgBId: string;
  let userA: Awaited<ReturnType<typeof createTestUser>>;
  let userB: Awaited<ReturnType<typeof createTestUser>>;

  beforeAll(async () => {
    await ensurePermissionsSeeded();
    const [orgA, orgB] = await Promise.all([createTestOrganization("Org A"), createTestOrganization("Org B")]);
    orgAId = orgA.id;
    orgBId = orgB.id;
    [userA, userB] = await Promise.all([createTestUser(orgA.id), createTestUser(orgB.id)]);
  });

  it("findMany ne renvoie jamais une ligne d'une autre organisation", async () => {
    const usersVisibleToA = await userA.db.user.findMany({});
    expect(usersVisibleToA.some((u) => u.id === userB.user.id)).toBe(false);
    expect(usersVisibleToA.some((u) => u.id === userA.user.id)).toBe(true);
  });

  it("findUnique par ID exact d'une autre organisation renvoie null, pas la ligne", async () => {
    const found = await userA.db.user.findUnique({ where: { id: userB.user.id } });
    expect(found).toBeNull();
  });

  it("update par ID deviné d'une autre organisation échoue et ne modifie rien", async () => {
    await expect(
      userA.db.user.update({ where: { id: userB.user.id }, data: { firstName: "Piraté" } }),
    ).rejects.toThrow();

    const stillIntact = await userB.db.user.findUnique({ where: { id: userB.user.id } });
    expect(stillIntact?.firstName).not.toBe("Piraté");
  });

  it("delete par ID deviné d'une autre organisation échoue et ne supprime rien", async () => {
    await expect(userA.db.user.delete({ where: { id: userB.user.id } })).rejects.toThrow();

    const stillExists = await userB.db.user.findUnique({ where: { id: userB.user.id } });
    expect(stillExists).not.toBeNull();
  });

  it("un organizationId falsifié dans les données d'un create est écrasé par le client scopé, jamais respecté", async () => {
    const roleInA = await userA.db.role.findFirstOrThrow({});
    const created = await userA.db.user.create({
      data: {
        organizationId: orgBId, // tentative de spoof
        email: `spoof-${Date.now()}@test.local`,
        password: "irrelevant",
        roleId: roleInA.id,
      },
    });

    expect(created.organizationId).toBe(orgAId);
    const visibleFromB = await userB.db.user.findUnique({ where: { id: created.id } });
    expect(visibleFromB).toBeNull();
  });

  it("les listes configurables provisionnées par défaut ne fuient pas entre organisations", async () => {
    const [itemsA, itemsB] = await Promise.all([
      userA.db.configurableListItem.findMany({ where: { listKey: "CALL_STATUS" } }),
      userB.db.configurableListItem.findMany({ where: { listKey: "CALL_STATUS" } }),
    ]);
    const idsA = new Set(itemsA.map((i) => i.id));
    expect(itemsB.some((i) => idsA.has(i.id))).toBe(false);
    expect(itemsA.length).toBeGreaterThan(0);
    expect(itemsB.length).toBeGreaterThan(0);
  });

  it("count est également scopé", async () => {
    const [countA, actualUsersA] = await Promise.all([userA.db.user.count({}), userA.db.user.findMany({})]);
    expect(countA).toBe(actualUsersA.length);
    expect(actualUsersA.some((u) => u.id === userB.user.id)).toBe(false);
  });

  it("une table sans organizationId propre (CallStatusHistory) reste scopée via son parent", async () => {
    const status = await userA.db.configurableListItem.findFirstOrThrow({ where: { listKey: "CALL_STATUS" } });
    const call = await userA.db.call.create({
      data: {
        organizationId: orgAId,
        userId: userA.user.id,
        direction: "OUTBOUND",
        type: "PROSPECTION",
        statusId: status.id,
        fromNumber: "+33000000000",
        toNumber: "+33000000005",
        occurredAt: new Date(),
      },
    });
    const history = await userA.db.callStatusHistory.create({
      data: { callId: call.id, newStatusId: status.id, changedById: userA.user.id },
    });

    // Org B ne fournit ni callId ni organizationId — seul un ID de ligne deviné.
    const foundFromB = await userB.db.callStatusHistory.findUnique({ where: { id: history.id } });
    expect(foundFromB).toBeNull();

    const foundFromA = await userA.db.callStatusHistory.findUnique({ where: { id: history.id } });
    expect(foundFromA?.id).toBe(history.id);
  });
});
