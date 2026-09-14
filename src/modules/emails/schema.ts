import { z } from "zod";

export const createEmailTemplateSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  subject: z.string().min(1),
  body: z.string().min(1),
  defaultAttachmentPath: z.string().optional(),
});
export type CreateEmailTemplateInput = z.infer<typeof createEmailTemplateSchema>;

export const updateEmailTemplateSchema = z.object({
  label: z.string().optional(),
  subject: z.string().optional(),
  body: z.string().optional(),
  defaultAttachmentPath: z.string().optional(),
  isActive: z.boolean().optional(),
});
export type UpdateEmailTemplateInput = z.infer<typeof updateEmailTemplateSchema>;

export const sendEmailSchema = z.object({
  clientId: z.string().min(1),
  templateKey: z.string().min(1),
  appointmentEventId: z.string().optional(),
  variables: z.record(z.string(), z.string()).optional(),
});
export type SendEmailInput = z.infer<typeof sendEmailSchema>;
