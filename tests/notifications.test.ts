import { beforeAll, describe, expect, it } from "vitest";
import { createNotification } from "../src/lib/notifications.js";
import * as notificationsService from "../src/modules/notifications/service.js";
import { createTestOrganization, createTestUser, ensurePermissionsSeeded } from "./helpers.js";

/**
 * Comme pour les rappels : portée au destinataire, distincte de l'isolation
 * multi-tenant générique déjà couverte par tenantIsolation.test.ts. Pas de route de
 * création publique (voir lib/notifications.ts) — les notifications de test sont
 * créées via `createNotification`, exactement comme le ferait modules/calendar/
 * service.ts pour un vrai événement métier.
 */
describe("notifications — scoping au destinataire", () => {
  let calliste: Awaited<ReturnType<typeof createTestUser>>;
  let agentRdv: Awaited<ReturnType<typeof createTestUser>>;

  beforeAll(async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Notifications");
    calliste = await createTestUser(org.id, "Agent calliste");
    agentRdv = await createTestUser(org.id, "Agent RDV");
  });

  it("chaque utilisateur ne voit que ses propres notifications, même dans la même organisation", async () => {
    await createNotification(calliste.db, {
      organizationId: calliste.authUser.organizationId,
      userId: calliste.user.id,
      type: "SYSTEM",
      title: "Pour Camille",
    });
    await createNotification(agentRdv.db, {
      organizationId: agentRdv.authUser.organizationId,
      userId: agentRdv.user.id,
      type: "APPOINTMENT_ASSIGNED",
      title: "Pour Robin",
    });

    const listedByCalliste = await notificationsService.listNotifications(calliste.db, calliste.authUser, {
      page: 1,
      pageSize: 25,
    });
    expect(listedByCalliste.items.some((n) => n.title === "Pour Camille")).toBe(true);
    expect(listedByCalliste.items.every((n) => n.title !== "Pour Robin")).toBe(true);
  });

  it("marquer comme lue la notification d'un autre utilisateur échoue (NotFound)", async () => {
    const notif = await createNotification(calliste.db, {
      organizationId: calliste.authUser.organizationId,
      userId: calliste.user.id,
      type: "SYSTEM",
      title: "Confidentiel à Camille",
    });

    await expect(notificationsService.markAsRead(agentRdv.db, agentRdv.authUser, notif.id)).rejects.toThrow();

    const stillUnread = await notificationsService.listNotifications(calliste.db, calliste.authUser, {
      page: 1,
      pageSize: 25,
    });
    expect(stillUnread.items.find((n) => n.id === notif.id)?.readAt).toBeNull();
  });

  it("unreadCount ne compte que les propres notifications non lues de l'appelant", async () => {
    const before = await notificationsService.listNotifications(agentRdv.db, agentRdv.authUser, {
      page: 1,
      pageSize: 25,
    });
    const notif = await createNotification(agentRdv.db, {
      organizationId: agentRdv.authUser.organizationId,
      userId: agentRdv.user.id,
      type: "SYSTEM",
      title: "Compte-moi",
    });

    const after = await notificationsService.listNotifications(agentRdv.db, agentRdv.authUser, {
      page: 1,
      pageSize: 25,
    });
    expect(after.unreadCount).toBe(before.unreadCount + 1);

    await notificationsService.markAsRead(agentRdv.db, agentRdv.authUser, notif.id);
    const afterRead = await notificationsService.listNotifications(agentRdv.db, agentRdv.authUser, {
      page: 1,
      pageSize: 25,
    });
    expect(afterRead.unreadCount).toBe(before.unreadCount);
  });

  it("markAllAsRead ne touche que les notifications de l'appelant", async () => {
    await createNotification(calliste.db, {
      organizationId: calliste.authUser.organizationId,
      userId: calliste.user.id,
      type: "SYSTEM",
      title: "À nettoyer",
    });
    const agentUnreadBefore = (
      await notificationsService.listNotifications(agentRdv.db, agentRdv.authUser, { page: 1, pageSize: 25 })
    ).unreadCount;

    await notificationsService.markAllAsRead(calliste.db, calliste.authUser);

    const callisteAfter = await notificationsService.listNotifications(calliste.db, calliste.authUser, {
      page: 1,
      pageSize: 25,
    });
    expect(callisteAfter.unreadCount).toBe(0);

    const agentAfter = await notificationsService.listNotifications(agentRdv.db, agentRdv.authUser, {
      page: 1,
      pageSize: 25,
    });
    expect(agentAfter.unreadCount).toBe(agentUnreadBefore);
  });
});
