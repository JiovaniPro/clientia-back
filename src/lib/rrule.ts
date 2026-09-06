import rrulePkg from "rrule";

// Interop CJS/ESM : les exports nommés de `rrule` ne sont pas fiables sous ESM.
const { rrulestr } = rrulePkg;

export interface Occurrence {
  start: Date;
  end: Date;
}

/** Étend un événement récurrent en occurrences dans [from, to], en excluant `exceptionDates`. */
export function expandRecurrence(
  event: { startAt: Date; endAt: Date; recurrenceRule: string; exceptionDates: unknown },
  from: Date,
  to: Date,
): Occurrence[] {
  const durationMs = event.endAt.getTime() - event.startAt.getTime();
  const excludedDates = Array.isArray(event.exceptionDates) ? (event.exceptionDates as string[]) : [];
  const excluded = new Set(excludedDates.map((d) => new Date(d).getTime()));

  const rule = rrulestr(event.recurrenceRule, { dtstart: event.startAt });

  return rule
    .between(from, to, true)
    .filter((date) => !excluded.has(date.getTime()))
    .map((start) => ({ start, end: new Date(start.getTime() + durationMs) }));
}
