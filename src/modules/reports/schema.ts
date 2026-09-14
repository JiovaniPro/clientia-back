import { z } from "zod";

export const reportsRangeQuerySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  /** Ignoré par /clients (pas de concept d'agent pertinent) ; sur /calls et
   * /appointments, forcé à l'id de l'appelant si celui-ci n'a pas reports.viewAll
   * — voir modules/reports/service.ts::canViewAll, jamais fait confiance tel quel. */
  userId: z.string().optional(),
});
export type ReportsRangeQuery = z.infer<typeof reportsRangeQuerySchema>;
