/**
 * Sous-lot C4 — bascule ponctuelle, à lancer UNE FOIS après le déploiement de la
 * détection de conflits multi-calendrier (portée élargie par rapport au sous-lot B,
 * qui ne cherchait que dans le même `calendarId`). Les conflits déjà en base ont pu
 * être calculés avec l'ancienne portée (trop étroite) et/ou l'ancien calcul de
 * sévérité (asymétrique, voir lib/conflictDetection.ts) — ce script les recalcule
 * tous avec la logique actuelle. Pas un job récurrent : le mécanisme normal reste
 * déclenché à la création/modification d'un événement (décision actée).
 *
 * Scope volontairement limité aux événements FUTURS (`endAt > now`) — un conflit
 * sur un événement déjà passé n'a plus d'utilité pratique pour l'utilisateur.
 *
 * Usage : npx tsx scripts/backfillEventConflicts.ts
 */
import { prisma } from "../src/db/prisma.js";
import { getScopedClient } from "../src/db/scopedClient.js";
import { syncEventConflicts } from "../src/lib/conflictDetection.js";

async function main() {
  const organizations = await prisma.organization.findMany({ select: { id: true, name: true } });
  let totalEvents = 0;
  let totalConflictPairs = 0;

  for (const org of organizations) {
    const db = getScopedClient(org.id);
    const events = await db.calendarEvent.findMany({
      where: { endAt: { gt: new Date() } },
      select: { id: true, calendarId: true, organizerId: true, startAt: true, endAt: true, availability: true },
    });

    for (const event of events) {
      const conflicts = await syncEventConflicts(db, event);
      totalConflictPairs += conflicts.length;
    }
    totalEvents += events.length;

    if (events.length > 0) {
      console.log(`[${org.name}] ${events.length} événement(s) futur(s) resynchronisé(s)`);
    }
  }

  console.log(`\nTerminé — ${totalEvents} événement(s) sur ${organizations.length} organisation(s), ${totalConflictPairs} paire(s) de conflit trouvée(s) au total (comptées une fois par côté synchronisé).`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
