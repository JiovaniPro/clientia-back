import { z } from "zod";

export const createClientSchema = z.object({
  callId: z.string().min(1),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  dossierStatusKey: z.string().optional(),
  agentId: z.string().min(1),
  phoneNumber: z.string().min(1),
  email: z.string().email().optional(),
  countryKey: z.string().min(1),
  civiliteKey: z.string().optional(),
  maritalStatusKey: z.string().optional(),
  birthDate: z.coerce.date().optional(),
  childrenKey: z.string().optional(),
  typeRdvKey: z.string().optional(),
  adresse: z.string().optional(),
  comment: z.string().optional(),
  finalStatusKey: z.string().optional(),
  adminNote: z.string().optional(),
});
export type CreateClientInput = z.infer<typeof createClientSchema>;

/** `callId`, `agentId` (réassignation) et `finalStatusKey` sont traités à part — voir service.ts. */
export const updateClientSchema = createClientSchema.partial().omit({ callId: true });
export type UpdateClientInput = z.infer<typeof updateClientSchema>;

export const listClientsQuerySchema = z.object({
  dossierStatusKey: z.string().optional(),
  finalStatusKey: z.string().optional(),
  agentId: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListClientsQuery = z.infer<typeof listClientsQuerySchema>;
