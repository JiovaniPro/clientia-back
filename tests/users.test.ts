import type { Request } from "express";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/db/prisma.js";
import { requireAnyPermission } from "../src/middleware/requirePermission.js";
import * as usersService from "../src/modules/users/service.js";
import { createTestOrganization, createTestUser, ensurePermissionsSeeded } from "./helpers.js";

describe("GET /users (listUsers)", () => {
  let orgA: Awaited<ReturnType<typeof createTestOrganization>>;
  let orgB: Awaited<ReturnType<typeof createTestOrganization>>;
  let adminA: Awaited<ReturnType<typeof createTestUser>>;
  let agentRdvA: Awaited<ReturnType<typeof createTestUser>>;
  let calResteA: Awaited<ReturnType<typeof createTestUser>>;
  let adminB: Awaited<ReturnType<typeof createTestUser>>;

  beforeAll(async () => {
    await ensurePermissionsSeeded();
    orgA = await createTestOrganization("Org Users A");
    orgB = await createTestOrganization("Org Users B");
    adminA = await createTestUser(orgA.id, "Administrateur");
    agentRdvA = await createTestUser(orgA.id, "Agent RDV");
    calResteA = await createTestUser(orgA.id, "Agent calliste");
    adminB = await createTestUser(orgB.id, "Administrateur");
    await prisma.user.update({ where: { id: agentRdvA.user.id }, data: { isActive: false } });
    await prisma.user.update({
      where: { id: calResteA.user.id },
      data: { firstName: "Camille", lastName: "Calliste" },
    });
  });

  it("isole par organisation : un utilisateur d'une org ne voit jamais ceux d'une autre", async () => {
    const results = await usersService.listUsers(adminA.db, {});
    const ids = results.map((u) => u.id);
    expect(ids).toContain(adminA.user.id);
    expect(ids).toContain(agentRdvA.user.id);
    expect(ids).not.toContain(adminB.user.id);
  });

  it("filtre par nom de rôle", async () => {
    const results = await usersService.listUsers(adminA.db, { role: "Agent RDV" });
    expect(results.map((u) => u.id)).toEqual([agentRdvA.user.id]);
    expect(results[0]?.role.name).toBe("Agent RDV");
  });

  it("filtre par isActive", async () => {
    const activeOnly = await usersService.listUsers(adminA.db, { isActive: true });
    expect(activeOnly.map((u) => u.id)).not.toContain(agentRdvA.user.id);

    const inactiveOnly = await usersService.listUsers(adminA.db, { isActive: false });
    expect(inactiveOnly.map((u) => u.id)).toEqual([agentRdvA.user.id]);
  });

  it("recherche par nom (insensible à la casse) — §C2 sélecteur de participant interne", async () => {
    const results = await usersService.listUsers(adminA.db, { search: "camille" });
    expect(results.map((u) => u.id)).toEqual([calResteA.user.id]);
  });

  it("recherche par email (partiel)", async () => {
    const results = await usersService.listUsers(adminA.db, { search: calResteA.user.email.slice(0, 8) });
    expect(results.map((u) => u.id)).toContain(calResteA.user.id);
  });

  it("recherche scopée à l'organisation — ne renvoie jamais un utilisateur d'une autre org", async () => {
    await prisma.user.update({ where: { id: adminB.user.id }, data: { firstName: "Camille", lastName: "Ailleurs" } });
    const results = await usersService.listUsers(adminA.db, { search: "camille" });
    expect(results.map((u) => u.id)).not.toContain(adminB.user.id);
  });

  it("ne renvoie jamais le mot de passe", async () => {
    const results = await usersService.listUsers(adminA.db, {});
    for (const u of results) {
      expect(u).not.toHaveProperty("password");
    }
  });

  /**
   * Décision documentée dans routes.ts : gate `clients.view` OU `users.view`, pas
   * `users.view` seul — les 3 rôles système ont tous `clients.view`, donc un Agent
   * calliste (qui n'a pas `users.view`) doit quand même pouvoir lister ses collègues
   * pour le sélecteur d'agent. Test au niveau middleware (pas juste au niveau
   * données de rôle) pour vérifier le gate réellement monté sur la route, pas
   * seulement l'intention documentée dans defaultRoles.ts.
   */
  it("le gate de la route laisse passer clients.view seul, bloque l'absence des deux", () => {
    const gate = requireAnyPermission(["clients.view", "users.view"]);

    expect(calResteA.authUser.permissions).toContain("clients.view");
    expect(calResteA.authUser.permissions).not.toContain("users.view");

    const next = vi.fn();
    gate({ user: calResteA.authUser } as unknown as Request, {} as never, next);
    expect(next).toHaveBeenCalledWith(); // appelé sans erreur => laissé passer

    const blockedUser = { ...calResteA.authUser, permissions: ["calendar.view"] };
    const nextBlocked = vi.fn();
    gate({ user: blockedUser } as unknown as Request, {} as never, nextBlocked);
    expect(nextBlocked).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });
});
