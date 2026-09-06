import { describe, expect, it } from "vitest";
import { HttpError } from "../src/lib/httpError.js";
import * as calendarService from "../src/modules/calendar/service.js";
import { createTestOrganization, createTestUser, ensurePermissionsSeeded } from "./helpers.js";

const CATEGORY_INPUT = { name: "Prospection chaude", color: "#c2410c", borderColor: "#9a3412" };

describe("catégories d'événements (sous-lot C1)", () => {
  it("CRUD complet : créer, lister, modifier, supprimer", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Event Categories");
    const user = await createTestUser(org.id, "Agent calliste");

    const created = await calendarService.createEventCategory(user.db, user.authUser, CATEGORY_INPUT);
    expect(created.name).toBe("Prospection chaude");
    expect(created.textColor).toBe("#FFFFFF"); // valeur par défaut appliquée

    const listed = await calendarService.listEventCategories(user.db, user.authUser);
    expect(listed.map((c) => c.id)).toContain(created.id);

    const updated = await calendarService.updateEventCategory(user.db, user.authUser, created.id, { color: "#059669" });
    expect(updated.color).toBe("#059669");
    expect(updated.name).toBe("Prospection chaude"); // champs non fournis inchangés

    await calendarService.deleteEventCategory(user.db, user.authUser, created.id);
    const afterDelete = await calendarService.listEventCategories(user.db, user.authUser);
    expect(afterDelete.map((c) => c.id)).not.toContain(created.id);
  });

  it("un deuxième nom identique pour le même utilisateur échoue en Conflict propre", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Event Categories Race");
    const user = await createTestUser(org.id, "Agent calliste");

    await calendarService.createEventCategory(user.db, user.authUser, CATEGORY_INPUT);

    let caught: unknown;
    try {
      await calendarService.createEventCategory(user.db, user.authUser, CATEGORY_INPUT);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(HttpError);
    expect((caught as HttpError).statusCode).toBe(409);
  });

  it("un utilisateur ne peut ni modifier ni supprimer la catégorie d'un autre utilisateur", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Event Categories Ownership");
    const owner = await createTestUser(org.id, "Agent calliste");
    const stranger = await createTestUser(org.id, "Agent calliste");

    const category = await calendarService.createEventCategory(owner.db, owner.authUser, CATEGORY_INPUT);

    await expect(
      calendarService.updateEventCategory(stranger.db, stranger.authUser, category.id, { color: "#000000" }),
    ).rejects.toMatchObject({ statusCode: 403 });

    await expect(calendarService.deleteEventCategory(stranger.db, stranger.authUser, category.id)).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it("attacher la catégorie d'un autre utilisateur à un événement est rejeté (BadRequest)", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Event Categories Cross Attach");
    const owner = await createTestUser(org.id, "Agent calliste");
    const stranger = await createTestUser(org.id, "Agent calliste");

    const category = await calendarService.createEventCategory(owner.db, owner.authUser, CATEGORY_INPUT);
    const calendar = await calendarService.createCalendar(stranger.db, stranger.authUser, {
      name: "Mon calendrier",
      color: "#1f6f54",
    });

    await expect(
      calendarService.createEvent(stranger.db, stranger.authUser, {
        calendarId: calendar.id,
        title: "Réunion",
        startAt: new Date("2026-09-10T10:00:00.000Z"),
        endAt: new Date("2026-09-10T11:00:00.000Z"),
        type: "MEETING",
        categoryId: category.id,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("supprimer une catégorie détache les événements qui l'utilisaient au lieu d'échouer", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Event Categories Detach");
    const user = await createTestUser(org.id, "Agent calliste");

    const category = await calendarService.createEventCategory(user.db, user.authUser, CATEGORY_INPUT);
    const calendar = await calendarService.createCalendar(user.db, user.authUser, {
      name: "Mon calendrier",
      color: "#1f6f54",
    });
    const event = await calendarService.createEvent(user.db, user.authUser, {
      calendarId: calendar.id,
      title: "Réunion catégorisée",
      startAt: new Date("2026-09-10T10:00:00.000Z"),
      endAt: new Date("2026-09-10T11:00:00.000Z"),
      type: "MEETING",
      categoryId: category.id,
    });
    expect(event.categoryId).toBe(category.id);

    await calendarService.deleteEventCategory(user.db, user.authUser, category.id);

    const refetched = await calendarService.getEvent(user.db, user.authUser, event.id);
    expect(refetched.categoryId).toBeNull();
  });
});
