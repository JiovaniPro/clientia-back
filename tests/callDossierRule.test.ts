import { beforeAll, describe, expect, it } from "vitest";
import { CLIENT_DOSSIER_REQUIRED_CODE } from "../src/modules/calls/service.js";
import * as callsService from "../src/modules/calls/service.js";
import * as clientsService from "../src/modules/clients/service.js";
import { createTestOrganization, createTestUser, ensurePermissionsSeeded } from "./helpers.js";

/**
 * §P0.2 : un statut d'appel avec `metadata.triggersClientDossierCreation` (ex.
 * "RDV pris") ne peut être enregistré que si un dossier Client existe déjà pour
 * l'appel — voir modules/calls/service.ts::changeCallStatus.
 */
describe("règle §P0.2 — statut nécessitant un dossier client", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;
  let callId: string;

  beforeAll(async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org P0.2");
    user = await createTestUser(org.id);

    const status = await user.db.configurableListItem.findFirstOrThrow({
      where: { listKey: "CALL_STATUS", isDefault: true },
    });
    const call = await user.db.call.create({
      data: {
        organizationId: org.id,
        userId: user.user.id,
        direction: "OUTBOUND",
        type: "PROSPECTION",
        statusId: status.id,
        fromNumber: "+33000000000",
        toNumber: "+33000000099",
        occurredAt: new Date(),
      },
    });
    callId = call.id;
  });

  it("refuse le changement de statut tant qu'aucun dossier n'existe", async () => {
    const error = await callsService
      .changeCallStatus(user.db, user.authUser, callId, { statusKey: "RDV_PRIS" })
      .catch((e) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as { statusCode?: number }).statusCode).toBe(409);
    expect((error as { details?: { code?: string } }).details?.code).toBe(CLIENT_DOSSIER_REQUIRED_CODE);
  });

  it("accepte le changement de statut une fois le dossier créé", async () => {
    const country = await user.db.configurableListItem.findFirstOrThrow({ where: { listKey: "CLIENT_COUNTRY" } });
    await clientsService.createClient(user.db, user.authUser, {
      callId,
      agentId: user.user.id,
      phoneNumber: "+33000000099",
      countryKey: country.key,
    });

    const { call } = await callsService.changeCallStatus(user.db, user.authUser, callId, { statusKey: "RDV_PRIS" });
    const status = await user.db.configurableListItem.findUniqueOrThrow({ where: { id: call.statusId } });
    expect(status.key).toBe("RDV_PRIS");
  });
});
