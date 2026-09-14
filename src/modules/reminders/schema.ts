import { z } from "zod";

export const createReminderSchema = z.object({
  callId: z.string().optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  dueAt: z.coerce.date(),
});
export type CreateReminderInput = z.infer<typeof createReminderSchema>;

export const updateReminderSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  dueAt: z.coerce.date().optional(),
  status: z.enum(["PENDING", "DONE", "CANCELED"]).optional(),
});
export type UpdateReminderInput = z.infer<typeof updateReminderSchema>;

export const listRemindersQuerySchema = z.object({
  status: z.enum(["PENDING", "DONE", "CANCELED"]).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  /** §5.19 — ignoré sans reminders.viewAll ; même avec elle, ne donne jamais accès
   * aux rappels personnels (callId: null) d'un AUTRE utilisateur — voir listReminders
   * dans service.ts, la garantie est structurelle, pas un simple filtre optionnel. */
  userId: z.string().optional(),
});
export type ListRemindersQuery = z.infer<typeof listRemindersQuerySchema>;
