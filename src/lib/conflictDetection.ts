import type { ScopedPrismaClient } from "../db/scopedClient.js";
import type { ConflictSeverity } from "../generated/prisma/enums.js";

function severityFor(overlapMinutes: number, totalDurationMinutes: number): ConflictSeverity {
  const ratio = totalDurationMinutes > 0 ? overlapMinutes / totalDurationMinutes : 0;
  if (ratio > 0.7) return "CRITICAL";
  if (ratio >= 0.3) return "WARNING";
  return "INFO";
}

function overlapMinutesBetween(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): number {
  const start = Math.max(aStart.getTime(), bStart.getTime());
  const end = Math.min(aEnd.getTime(), bEnd.getTime());
  return Math.max(0, Math.round((end - start) / 60000));
}

interface EventForConflict {
  id: string;
  calendarId: string;
  startAt: Date;
  endAt: Date;
  availability: string;
}

/**
 * Recalcule et persiste les chevauchements d'un événement avec les autres événements
 * BUSY/TENTATIVE du même calendrier. Purement informatif (superposition affichée au
 * front) — distinct des deux invariants métier de rendez-vous, vérifiés séparément
 * dans modules/calendar/service.ts avant toute écriture.
 */
export async function syncEventConflicts(db: ScopedPrismaClient, event: EventForConflict) {
  await db.eventConflict.deleteMany({ where: { OR: [{ eventId: event.id }, { conflictingId: event.id }] } });

  if (event.availability === "FREE") return [];

  const candidates = await db.calendarEvent.findMany({
    where: {
      calendarId: event.calendarId,
      id: { not: event.id },
      availability: { in: ["BUSY", "TENTATIVE"] },
      startAt: { lt: event.endAt },
      endAt: { gt: event.startAt },
    },
  });

  if (candidates.length === 0) return [];

  const totalDuration = Math.max(1, Math.round((event.endAt.getTime() - event.startAt.getTime()) / 60000));

  const conflicts = candidates.map((candidate) => {
    const overlapMinutes = overlapMinutesBetween(event.startAt, event.endAt, candidate.startAt, candidate.endAt);
    return { conflictingId: candidate.id, overlapMinutes, severity: severityFor(overlapMinutes, totalDuration) };
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
