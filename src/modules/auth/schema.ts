import { z } from "zod";

/**
 * `organizationSlug` : ajout par rapport au brief de design initial (email + mot de
 * passe seulement) — nécessaire car `User.email` est unique par organisation, pas
 * globalement (voir §3 du plan). Affiché comme un champ "espace de travail" avant
 * email/mot de passe.
 */
export const loginSchema = z.object({
  organizationSlug: z.string().min(1, "Espace de travail requis"),
  email: z.string().email("E-mail invalide"),
  password: z.string().min(1, "Mot de passe requis"),
});
export type LoginInput = z.infer<typeof loginSchema>;
