import { z } from "zod";

const fieldTypeEnum = z.enum([
  "TEXT",
  "TEXTAREA",
  "NUMBER",
  "DATE",
  "SELECT",
  "MULTISELECT",
  "CHECKBOX",
  "EMAIL",
  "PHONE",
]);

export const createCustomFieldDefinitionSchema = z.object({
  entityType: z.string().min(1),
  key: z.string().min(1),
  label: z.string().min(1),
  fieldType: fieldTypeEnum,
  options: z.array(z.string()).optional(),
  isRequired: z.boolean().optional(),
  order: z.number().int().optional(),
  section: z.string().optional(),
});
export type CreateCustomFieldDefinitionInput = z.infer<typeof createCustomFieldDefinitionSchema>;

export const updateCustomFieldDefinitionSchema = z.object({
  label: z.string().optional(),
  options: z.array(z.string()).optional(),
  isRequired: z.boolean().optional(),
  order: z.number().int().optional(),
  section: z.string().optional(),
  isActive: z.boolean().optional(),
});
export type UpdateCustomFieldDefinitionInput = z.infer<typeof updateCustomFieldDefinitionSchema>;

export const setCustomFieldValuesSchema = z.object({
  values: z.array(z.object({ definitionId: z.string().min(1), value: z.unknown() })),
});
export type SetCustomFieldValuesInput = z.infer<typeof setCustomFieldValuesSchema>;
