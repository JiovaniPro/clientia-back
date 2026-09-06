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
});
export type ListRemindersQuery = z.infer<typeof listRemindersQuerySchema>;
