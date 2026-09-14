import { z } from "zod";

export const setOrganizationStatusSchema = z.object({ isActive: z.boolean() });
export type SetOrganizationStatusInput = z.infer<typeof setOrganizationStatusSchema>;
