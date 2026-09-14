import { describe, expect, it } from "vitest";
import { prisma } from "../src/db/prisma.js";
import * as platformDashboardService from "../src/modules/platform/dashboard/service.js";
import * as platformOrganizationsService from "../src/modules/platform/organizations/service.js";
import { createTestOrganization, createTestUser, ensurePermissionsSeeded } from "./helpers.js";

const PLATFORM_ADMIN = { id: "test-platform-admin-dashboard", email: "dashboard-admin@clientia.app" };

describe("§5.29 sous-lot 7 — tableau de bord global", () => {
  it("les compteurs augmentent exactement de ce qui vient d'être créé", async () => {
    await ensurePermissionsSeeded();
    const before = await platformDashboardService.getDashboardStats();

    const org = await createTestOrganization("Org Dashboard");
    await createTestUser(org.id, "Administrateur");
    await createTestUser(org.id, "Agent RDV");

    const after = await platformDashboardService.getDashboardStats();

    expect(after.organizations.total).toBe(before.organizations.total + 1);
    expect(after.organizations.active).toBe(before.organizations.active + 1);
    expect(after.users.total).toBe(before.users.total + 2);
  });

  it("suspendre une organisation déplace son compte de actives vers suspendues, sans changer le total", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Dashboard Suspend");
    const before = await platformDashboardService.getDashboardStats();

    await platformOrganizationsService.setOrganizationStatus(org.id, { isActive: false }, PLATFORM_ADMIN);
    const after = await platformDashboardService.getDashboardStats();

    expect(after.organizations.total).toBe(before.organizations.total);
    expect(after.organizations.active).toBe(before.organizations.active - 1);
    expect(after.organizations.suspended).toBe(before.organizations.suspended + 1);
  });

  it("compte les appels tous organisations confondues", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Dashboard Calls");
    const admin = await createTestUser(org.id, "Administrateur");
    const status = await admin.db.configurableListItem.findFirstOrThrow({
      where: { listKey: "CALL_STATUS", isDefault: true },
    });

    const before = await platformDashboardService.getDashboardStats();

    await prisma.call.create({
      data: {
        organizationId: org.id,
        userId: admin.user.id,
        direction: "OUTBOUND",
        type: "PROSPECTION",
        statusId: status.id,
        fromNumber: "+33000000000",
        toNumber: "+33000000001",
        occurredAt: new Date(),
      },
    });

    const after = await platformDashboardService.getDashboardStats();
    expect(after.calls.total).toBe(before.calls.total + 1);
  });
});
