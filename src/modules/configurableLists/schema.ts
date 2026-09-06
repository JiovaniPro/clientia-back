import { z } from "zod";

export const createListItemSchema = z.object({
  listKey: z.string().min(1),
  key: z.string().min(1),
  label: z.string().min(1),
  color: z.string().optional(),
  order: z.number().int().optional(),
  isDefault: z.boolean().optional(),
  metadata: z.record(z.string(), z.boolean()).optional(),
});
export type CreateListItemInput = z.infer<typeof createListItemSchema>;

/** Pas de suppression physique exposée — `isActive: false` est la façon de "retirer"
 * une valeur déjà utilisée par des enregistrements existants (voir schema.prisma). */
export const updateListItemSchema = z.object({
  label: z.string().optional(),
  color: z.string().optional(),
  order: z.number().int().optional(),
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  metadata: z.record(z.string(), z.boolean()).optional(),
});
export type UpdateListItemInput = z.infer<typeof updateListItemSchema>;
