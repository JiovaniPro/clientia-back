import { describe, expect, it } from "vitest";
import { HttpError } from "../src/lib/httpError.js";
import * as calendarService from "../src/modules/calendar/service.js";
import { createTestOrganization, createTestUser, ensurePermissionsSeeded } from "./helpers.js";

/**
 * Bug réel observé en local par l'utilisateur : `POST /calendars` (via
 * CalendarProPage::ensureCalendar, qui liste puis crée si absent) échouait en 500
 * nu (contrainte unique `Calendar_userId_name_key`) quand deux appels concurrents
 * du même utilisateur tentaient tous les deux de créer "Mon calendrier" — le mount
 * effect de React peut se déclencher deux fois (Strict Mode). Corrigé des deux
 * côtés : dédoublonnage côté frontend (ensureCalendarInFlight, même pattern que
 * /auth/refresh) pour éviter l'appel redondant dans le cas courant, ET ce
 * traitement propre côté service pour toute requête concurrente que le client ne
 * peut pas voir (autre onglet, autre appareil).
 */
describe("création de calendrier — course sur le nom", () => {
  it("un deuxième calendrier de même nom pour le même utilisateur échoue en Conflict propre, pas en 500 nu", async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Calendar Create Race");
    const user = await createTestUser(org.id, "Agent calliste");

    const first = await calendarService.createCalendar(user.db, user.authUser, {
      name: "Mon calendrier",
      color: "#1f6f54",
    });
    expect(first.id).toBeTruthy();

    let caught: unknown;
    try {
      await calendarService.createCalendar(user.db, user.authUser, {
        name: "Mon calendrier",
        color: "#1f6f54",
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(HttpError);
    expect((caught as HttpError).statusCode).toBe(409);
  });
});
