import { z } from "zod";

export const listUsersQuerySchema = z.object({
  role: z.string().optional(),
  isActive: z.coerce.boolean().optional(),
  /** Recherche libre nom/email — §C2, sélecteur de participant interne. */
  search: z.string().optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const createUserSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  roleId: z.string().min(1),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  email: z.string().email().optional(),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  roleId: z.string().min(1).optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const setUserStatusSchema = z.object({
  isActive: z.boolean(),
});
export type SetUserStatusInput = z.infer<typeof setUserStatusSchema>;
