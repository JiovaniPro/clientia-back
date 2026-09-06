import { beforeAll, describe, expect, it } from "vitest";
import * as callsService from "../src/modules/calls/service.js";
import * as clientsService from "../src/modules/clients/service.js";
import { createTestOrganization, createTestUser, ensurePermissionsSeeded } from "./helpers.js";

/**
 * §P0.2 / §5.6 : "À appeler" ne doit montrer que le statut neutre (le défaut de
 * CALL_STATUS, "A_CONTACTER" dans le seed) ; le Journal montre tout SAUF ce
 * statut. Gap trouvé en revue : ni l'un ni l'autre n'était appliqué par défaut
 * côté frontend — un appel qualifié restait visible indéfiniment dans "À
 * appeler". Corrigé via `excludeStatusKey` + `sort: "queue"` dans
 * modules/calls/service.ts::listCalls.
 */
describe("file d'appels — filtre statut neutre et tri file", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;
  let neutralKey: string;
  let untouchedCallId: string;
  let qualifiedCallId: string;

  beforeAll(async () => {
    await ensurePermissionsSeeded();
    const org = await createTestOrganization("Org Calls Queue");
    user = await createTestUser(org.id);

    const neutral = await user.db.configurableListItem.findFirstOrThrow({
      where: { listKey: "CALL_STATUS", isDefault: true },
    });
    neutralKey = neutral.key;

    const untouched = await user.db.call.create({
      data: {
        organizationId: org.id,
        userId: user.user.id,
        direction: "OUTBOUND",
        type: "PROSPECTION",
        statusId: neutral.id,
        fromNumber: "+33000000000",
        toNumber: "+33000000010",
        occurredAt: new Date(),
        lastName: "Zimmer",
      },
    });
    untouchedCallId = untouched.id;

    const qualified = await user.db.call.create({
      data: {
        organizationId: org.id,
        userId: user.user.id,
        direction: "OUTBOUND",
        type: "PROSPECTION",
        statusId: neutral.id,
        fromNumber: "+33000000000",
        toNumber: "+33000000011",
        occurredAt: new Date(),
        lastName: "Abel",
      },
    });
    qualifiedCallId = qualified.id;
    const country = await user.db.configurableListItem.findFirstOrThrow({ where: { listKey: "CLIENT_COUNTRY" } });
    await clientsService.createClient(user.db, user.authUser, {
      callId: qualifiedCallId,
      agentId: user.user.id,
      phoneNumber: "+33000000011",
      countryKey: country.key,
    });
    await callsService.changeCallStatus(user.db, user.authUser, qualifiedCallId, { statusKey: "RDV_PRIS" });
  });

  it('"À appeler" (statusKey = neutre) ne montre pas un appel déjà qualifié', async () => {
    const { items } = await callsService.listCalls(user.db, user.authUser, {
      statusKey: neutralKey,
      sort: "queue",
      page: 1,
      pageSize: 25,
    });
    const ids = items.map((c) => c.id);
    expect(ids).toContain(untouchedCallId);
    expect(ids).not.toContain(qualifiedCallId);
  });

  it('Journal (excludeStatusKey = neutre) ne montre pas un appel encore "à contacter"', async () => {
    const { items } = await callsService.listCalls(user.db, user.authUser, {
      excludeStatusKey: neutralKey,
      sort: "recent",
      page: 1,
      pageSize: 25,
    });
    const ids = items.map((c) => c.id);
    expect(ids).toContain(qualifiedCallId);
    expect(ids).not.toContain(untouchedCallId);
  });

  it('un appel qualifié "disparaît" de la file et "apparaît" dans le journal au même instant', async () => {
    const queue = await callsService.listCalls(user.db, user.authUser, {
      statusKey: neutralKey,
      sort: "queue",
      page: 1,
      pageSize: 25,
    });
    const journal = await callsService.listCalls(user.db, user.authUser, {
      excludeStatusKey: neutralKey,
      sort: "recent",
      page: 1,
      pageSize: 25,
    });
    const inQueue = queue.items.some((c) => c.id === qualifiedCallId);
    const inJournal = journal.items.some((c) => c.id === qualifiedCallId);
    expect(inQueue).toBe(false);
    expect(inJournal).toBe(true);
  });

  it('tri "queue" ordonne par vague puis nom puis prénom', async () => {
    const org2 = await createTestOrganization("Org Calls Queue Sort");
    const user2 = await createTestUser(org2.id);
    const neutral2 = await user2.db.configurableListItem.findFirstOrThrow({
      where: { listKey: "CALL_STATUS", isDefault: true },
    });

    await user2.db.call.createMany({
      data: [
        {
          organizationId: org2.id,
          userId: user2.user.id,
          direction: "OUTBOUND",
          type: "PROSPECTION",
          statusId: neutral2.id,
          fromNumber: "+33",
          toNumber: "+33000000021",
          occurredAt: new Date(),
          waveNumber: 2,
          lastName: "Abel",
        },
        {
          organizationId: org2.id,
          userId: user2.user.id,
          direction: "OUTBOUND",
          type: "PROSPECTION",
          statusId: neutral2.id,
          fromNumber: "+33",
          toNumber: "+33000000022",
          occurredAt: new Date(),
          waveNumber: 1,
          lastName: "Zimmer",
        },
        {
          organizationId: org2.id,
          userId: user2.user.id,
          direction: "OUTBOUND",
          type: "PROSPECTION",
          statusId: neutral2.id,
          fromNumber: "+33",
          toNumber: "+33000000023",
          occurredAt: new Date(),
          waveNumber: 1,
          lastName: "Abel",
        },
      ],
    });

    const { items } = await callsService.listCalls(user2.db, user2.authUser, {
      sort: "queue",
      page: 1,
      pageSize: 25,
    });
    expect(items.map((c) => `${c.waveNumber}-${c.lastName}`)).toEqual(["1-Abel", "1-Zimmer", "2-Abel"]);
  });
});
