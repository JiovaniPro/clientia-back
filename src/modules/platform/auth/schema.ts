import { z } from "zod";

/** Pas de champ "espace de travail" — un Super Admin n'appartient à aucune organisation. */
export const platformLoginSchema = z.object({
  email: z.string().email("E-mail invalide"),
  password: z.string().min(1, "Mot de passe requis"),
});
export type PlatformLoginInput = z.infer<typeof platformLoginSchema>;

export const changePlatformAdminPasswordSchema = z.object({
  currentPassword: z.string().min(1, "Mot de passe actuel requis"),
  newPassword: z.string().min(8, "8 caractères minimum"),
});
export type ChangePlatformAdminPasswordInput = z.infer<typeof changePlatformAdminPasswordSchema>;
