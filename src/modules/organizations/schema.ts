import { z } from "zod";

const slugPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const createOrganizationSchema = z.object({
  organizationName: z.string().min(2, "Nom trop court"),
  organizationSlug: z
    .string()
    .min(2, "Identifiant trop court")
    .regex(slugPattern, "Lettres minuscules, chiffres et tirets uniquement"),
  adminEmail: z.string().email("E-mail invalide"),
  adminPassword: z.string().min(8, "8 caractères minimum"),
  adminFirstName: z.string().optional(),
  adminLastName: z.string().optional(),
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

export const updateOrganizationSchema = z.object({
  name: z.string().min(2).optional(),
  // nullable : `null` efface explicitement le logo — un simple `undefined` (champ
  // absent) laisse la valeur existante inchangée, comme pour les autres champs.
  logoUrl: z.string().url().nullable().optional(),
  primaryColor: z.string().optional(),
});
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
