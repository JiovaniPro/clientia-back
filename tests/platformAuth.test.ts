import bcrypt from "bcryptjs";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { signAccessToken } from "../src/lib/jwt.js";
import { createTestOrganization, createTestUser, ensurePermissionsSeeded } from "./helpers.js";

const app = createApp();

async function createTestPlatformAdmin(emailPrefix = "platform-admin") {
  const email = `${emailPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
  const password = "PlatformPassw0rd!";
  const hashed = await bcrypt.hash(password, 4); // coût réduit — tests uniquement
  const platformAdmin = await prisma.platformAdmin.create({
    data: { email, password: hashed, name: "Test Platform Admin" },
  });
  return { platformAdmin, email, password };
}

describe("§5.29 sous-lot 1 — authentification Super Admin", () => {
  it("se connecte avec un compte plateforme valide et reçoit un accessToken", async () => {
    const { email, password } = await createTestPlatformAdmin();

    const res = await request(app).post("/platform/auth/login").send({ email, password });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.platformAdmin.email).toBe(email);
    expect(res.body.platformAdmin).not.toHaveProperty("password");
  });

  it("refuse un mauvais mot de passe", async () => {
    const { email } = await createTestPlatformAdmin();

    const res = await request(app).post("/platform/auth/login").send({ email, password: "MauvaisMotDePasse" });

    expect(res.status).toBe(401);
  });

  it("refuse un compte plateforme désactivé", async () => {
    const { platformAdmin, email, password } = await createTestPlatformAdmin();
    await prisma.platformAdmin.update({ where: { id: platformAdmin.id }, data: { isActive: false } });

    const res = await request(app).post("/platform/auth/login").send({ email, password });

    expect(res.status).toBe(401);
  });

  it("pose le cookie de rafraîchissement plateforme sur le chemin /platform/auth uniquement", async () => {
    const { email, password } = await createTestPlatformAdmin();

    const res = await request(app).post("/platform/auth/login").send({ email, password });

    const setCookie = res.headers["set-cookie"];
    const cookieHeader = Array.isArray(setCookie) ? setCookie.join(";") : String(setCookie);
    expect(cookieHeader).toContain("platformRefreshToken=");
    expect(cookieHeader).toContain("Path=/platform/auth");
  });

  it("rafraîchit puis révoque la session via /refresh et /logout", async () => {
    const { email, password } = await createTestPlatformAdmin();
    const agent = request.agent(app);

    const loginRes = await agent.post("/platform/auth/login").send({ email, password });
    expect(loginRes.status).toBe(200);

    const refreshRes = await agent.post("/platform/auth/refresh").send();
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.accessToken).toBeTruthy();

    const logoutRes = await agent.post("/platform/auth/logout").send();
    expect(logoutRes.status).toBe(204);

    // Après logout, le cookie de session (révoqué) ne doit plus permettre de rafraîchir.
    const refreshAfterLogout = await agent.post("/platform/auth/refresh").send();
    expect(refreshAfterLogout.status).toBe(401);
  });

  it("GET /platform/auth/me exige un token plateforme valide", async () => {
    const { email, password } = await createTestPlatformAdmin();
    const loginRes = await request(app).post("/platform/auth/login").send({ email, password });

    const meRes = await request(app)
      .get("/platform/auth/me")
      .set("Authorization", `Bearer ${loginRes.body.accessToken}`);

    expect(meRes.status).toBe(200);
    expect(meRes.body.platformAdmin.email).toBe(email);
  });
});

/**
 * Le fondement de tout §5.29 (voir la proposition, point 5) : preuve exécutable,
 * pas juste une affirmation. Un token plateforme et un token utilisateur d'organisation
 * doivent être structurellement incapables de fonctionner l'un à la place de l'autre.
 */
describe("§5.29 — étanchéité Super Admin / utilisateur d'organisation", () => {
  it("un token PLATEFORME valide est rejeté sur une route d'ORGANISATION (401)", async () => {
    const { email, password } = await createTestPlatformAdmin();
    const loginRes = await request(app).post("/platform/auth/login").send({ email, password });
    const platformToken = loginRes.body.accessToken as string;

    // Contrôle positif : ce même token fonctionne bien côté plateforme.
    const platformSideRes = await request(app)
      .get("/platform/auth/me")
      .set("Authorization", `Bearer ${platformToken}`);
    expect(platformSideRes.status).toBe(200);

    // Le test qui compte : présenté à une route d'organisation, il doit être rejeté.
    const orgSideRes = await request(app).get("/auth/me").set("Authorization", `Bearer ${platformToken}`);
    expect(orgSideRes.status).toBe(401);
  });

  it("un token UTILISATEUR D'ORGANISATION valide est rejeté sur une route PLATEFORME (401)", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Platform Isolation");
    const admin = await createTestUser(org.id, "Administrateur");
    const orgToken = signAccessToken(admin.user.id);

    // Contrôle positif : ce même token fonctionne bien côté organisation.
    const orgSideRes = await request(app).get("/auth/me").set("Authorization", `Bearer ${orgToken}`);
    expect(orgSideRes.status).toBe(200);

    // Le test qui compte : présenté à une route plateforme, il doit être rejeté.
    const platformSideRes = await request(app).get("/platform/auth/me").set("Authorization", `Bearer ${orgToken}`);
    expect(platformSideRes.status).toBe(401);
  });

  it("un même id (collision cuid improbable mais possible) ne suffirait pas : les secrets JWT sont différents", async () => {
    // Preuve indépendante du hasard des ids : signer un jeton "organisation" pour l'id
    // d'un VRAI PlatformAdmin ne le rend pas valide côté plateforme (mauvais secret),
    // et réciproquement — la garantie ne dépend pas de l'absence de collision d'id.
    const { platformAdmin } = await createTestPlatformAdmin();
    const orgShapedTokenForPlatformId = signAccessToken(platformAdmin.id);

    const platformSideRes = await request(app)
      .get("/platform/auth/me")
      .set("Authorization", `Bearer ${orgShapedTokenForPlatformId}`);
    expect(platformSideRes.status).toBe(401);

    const orgSideRes = await request(app)
      .get("/auth/me")
      .set("Authorization", `Bearer ${orgShapedTokenForPlatformId}`);
    expect(orgSideRes.status).toBe(401); // aucun User ne porte l'id d'un PlatformAdmin
  });
});
