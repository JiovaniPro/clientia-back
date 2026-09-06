import { z } from "zod";

export const listUsersQuerySchema = z.object({
  role: z.string().optional(),
  isActive: z.coerce.boolean().optional(),
  /** Recherche libre nom/email — §C2, sélecteur de participant interne. */
  search: z.string().optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
