import type { ScopedPrismaClient } from "../db/scopedClient.js";
import type { ConflictSeverity } from "../generated/prisma/enums.js";

/**
 * Sous-lot C4 — bug trouvé en relisant le calcul du sous-lot B avant d'y brancher
 * l'affichage : le ratio utilisait la durée de L'ÉVÉNEMENT QUI VIENT D'ÊTRE
 * SYNCHRONISÉ comme dénominateur, pas une propriété stable de la paire. Un point de
 * 10 min entièrement inclus dans un bloc de 60 min ressortait CRITIQUE (10/10) si
 * c'est le point qui se synchronisait en dernier, ou INFO (10/60) si c'est le bloc —
 * la sévérité changeait selon l'ordre de création/modification. Corrigé en prenant
 * la durée du PLUS COURT des deux événements comme dénominateur : invariant quel
 * que soit celui des deux qui déclenche la resynchronisation, et c'est aussi la
 * lecture la plus utile (un rendez-vous court entièrement avalé par un autre est
 * réellement critique pour lui, peu importe la taille du second).
 */
function severityFor(overlapMinutes: number, shorterDurationMinutes: number): ConflictSeverity {
  const ratio = shorterDurationMinutes > 0 ? overlapMinutes / shorterDurationMinutes : 0;
  if (ratio > 0.7) return "CRITICAL";
  if (ratio >= 0.3) return "WARNING";
  return "INFO";
}

function overlapMinutesBetween(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): number {
  const start = Math.max(aStart.getTime(), bStart.getTime());
  const end = Math.min(aEnd.getTime(), bEnd.getTime());
  return Math.max(0, Math.round((end - start) / 60000));
}

function durationMinutes(start: Date, end: Date): number {
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000));
}

interface EventForConflict {
  id: string;
  calendarId: string;
  organizerId: string;
  startAt: Date;
  endAt: Date;
  availability: string;
}

/**
 * Recalcule et persiste les chevauchements d'un événement avec les autres événements
 * BUSY/TENTATIVE. Purement informatif (superposition affichée au front) — distinct
 * des deux invariants métier de rendez-vous, vérifiés séparément dans
 * modules/calendar/service.ts avant toute écriture (ceux-là bloquent, ceci ne fait
 * que signaler — décision actée avec l'utilisateur, §P1.1).
 *
 * Portée multi-calendrier (sous-lot C4, décision actée) : les candidats sont
 * cherchés parmi les calendriers visibles de L'ORGANISATEUR de cet événement (ses
 * propres calendriers + les calendriers globaux) — pas parmi tout ce qu'un
 * spectateur voit (`calendar.viewAll`), puisqu'un conflit est une propriété de la
 * paire d'événements, pas du spectateur qui la consulte. Même règle de visibilité
 * que `listCalendars`, appliquée ici à l'organisateur plutôt qu'à l'appelant.
 *
 * LIMITE CONNUE, ACTÉE CONSCIEMMENT (pas un oubli) — sous-lot C4, relu et confirmé
 * avec l'utilisateur : ce calcul ne porte QUE sur `startAt`/`endAt` stockés de
 * l'événement (le modèle, pour une série récurrente), jamais sur chaque occurrence
 * recalculée par `expandRecurrence`. Le cahier des charges ne distingue pourtant pas
 * événement simple/récurrent pour la détection de conflit — c'est donc un vrai trou
 * de couverture (une série hebdomadaire peut chevaucher un événement futur sans que
 * ça soit jamais détecté), pas juste une nuance technique. Laissé en l'état pour
 * l'instant, décision explicite plutôt que découverte tardive — comparer à
 * `EventReminderFiring` (sous-lot C3) qui, lui, résout le même genre de problème
 * par occurrence : si ce gap doit être comblé, le même type de table de
 * déduplication par occurrence serait le point de départ.
 */
export async function syncEventConflicts(db: ScopedPrismaClient, event: EventForConflict) {
  await db.eventConflict.deleteMany({ where: { OR: [{ eventId: event.id }, { conflictingId: event.id }] } });

  if (event.availability === "FREE") return [];

  const [visibleCalendars, ownCalendar] = await Promise.all([
    db.calendar.findMany({ where: { OR: [{ userId: event.organizerId }, { isGlobal: true }] }, select: { id: true } }),
    db.calendar.findUnique({ where: { id: event.calendarId }, select: { isGlobal: true } }),
  ]);

  const overlapFilter = {
    id: { not: event.id },
    availability: { in: ["BUSY", "TENTATIVE"] as ("BUSY" | "TENTATIVE")[] },
    startAt: { lt: event.endAt },
    endAt: { gt: event.startAt },
  };

  /**
   * Bug trouvé en testant les deux ordres de création possibles avant de livrer
   * C4 (pas hérité du sous-lot B — introduit par cette portée multi-calendrier) :
   * filtrer les candidats par "calendriers visibles de L'ORGANISATEUR DE CET
   * ÉVÉNEMENT" est correct quand cet événement est sur un calendrier privé, mais
   * cassait dans l'autre sens : un événement sur un calendrier GLOBAL, par
   * définition visible de tout le monde, ne trouvait que les candidats visibles de
   * SON organisateur à lui — jamais l'événement privé d'un tiers, même si CE
   * tiers pouvait très bien voir l'événement global. Concrètement : événement A
   * (privé, userA) créé avant événement B (calendrier global, userB) — la sync de
   * B ne trouvait pas A (calendrier de A invisible pour userB), alors que la sync
   * de A (si A avait été créé après B) aurait bien trouvé B. Le conflit existait
   * ou non selon l'ORDRE de création — pas acceptable. Corrigé : un événement sur
   * un calendrier global n'est pas filtré par visibilité d'organisateur — il est
   * par construction pertinent pour tout le monde, dans les deux sens.
   */
  const candidates = await db.calendarEvent.findMany({
    where: ownCalendar?.isGlobal
      ? overlapFilter
      : {
          ...overlapFilter,
          calendarId: { in: [...new Set([...visibleCalendars.map((c) => c.id), event.calendarId])] },
        },
  });

  if (candidates.length === 0) return [];

  const eventDuration = durationMinutes(event.startAt, event.endAt);

  const conflicts = candidates.map((candidate) => {
    const overlapMinutes = overlapMinutesBetween(event.startAt, event.endAt, candidate.startAt, candidate.endAt);
    const candidateDuration = durationMinutes(candidate.startAt, candidate.endAt);
    const severity = severityFor(overlapMinutes, Math.min(eventDuration, candidateDuration));
    return { conflictingId: candidate.id, overlapMinutes, severity };
  });

  await db.eventConflict.createMany({
    data: conflicts.map((c) => ({
      eventId: event.id,
      conflictingId: c.conflictingId,
      severity: c.severity,
      overlapMinutes: c.overlapMinutes,
    })),
  });

  return conflicts;
}
