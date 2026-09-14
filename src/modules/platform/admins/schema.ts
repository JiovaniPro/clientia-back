import { z } from "zod";

export const createPlatformAdminSchema = z.object({
  email: z.string().email("E-mail invalide"),
  password: z.string().min(8, "8 caractères minimum"),
  name: z.string().min(1).optional(),
});
export type CreatePlatformAdminInput = z.infer<typeof createPlatformAdminSchema>;

export const updatePlatformAdminSchema = z.object({
  email: z.string().email().optional(),
  name: z.string().min(1).optional(),
});
export type UpdatePlatformAdminInput = z.infer<typeof updatePlatformAdminSchema>;

export const setPlatformAdminStatusSchema = z.object({ isActive: z.boolean() });
export type SetPlatformAdminStatusInput = z.infer<typeof setPlatformAdminStatusSchema>;
