import { z } from "zod";

export const reportsRangeQuerySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
});
export type ReportsRangeQuery = z.infer<typeof reportsRangeQuerySchema>;
