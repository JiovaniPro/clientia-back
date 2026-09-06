import { z } from "zod";

export const createCallSchema = z.object({
  direction: z.enum(["INBOUND", "OUTBOUND"]),
  type: z.enum(["PROSPECTION", "SUPPORT", "FOLLOW_UP", "OTHER"]),
  statusKey: z.string().min(1),
  fromNumber: z.string().min(1),
  toNumber: z.string().min(1),
  durationSec: z.number().int().nonnegative().optional(),
  notes: z.string().optional(),
  occurredAt: z.coerce.date(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  email: z.string().email().optional(),
  recallDate: z.coerce.date().optional(),
  recallTimeSlot: z.string().optional(),
});
export type CreateCallInput = z.infer<typeof createCallSchema>;

export const updateCallSchema = z.object({
  notes: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  email: z.string().email().optional(),
  recallDate: z.coerce.date().optional(),
  recallTimeSlot: z.string().optional(),
});
export type UpdateCallInput = z.infer<typeof updateCallSchema>;

/** Changement de statut : passe par un chemin dédié — écrit CallStatusHistory. */
export const changeCallStatusSchema = z.object({
  statusKey: z.string().min(1),
  recallDate: z.coerce.date().optional(),
  recallTimeSlot: z.string().optional(),
});
export type ChangeCallStatusInput = z.infer<typeof changeCallStatusSchema>;

export const listCallsQuerySchema = z.object({
  statusKey: z.string().optional(),
  /**
   * §P0.2/§5.6 : "À appeler" ne montre que le statut neutre (statusKey = le
   * défaut de CALL_STATUS) ; "Journal" montre tout SAUF le statut neutre. Ce
   * filtre générique (pas de comparaison en dur à "A_CONTACTER", la clé réelle
   * dépend de la config de l'organisation) permet les deux sans dupliquer la
   * logique — voir listCalls dans service.ts.
   */
  excludeStatusKey: z.string().optional(),
  type: z.enum(["PROSPECTION", "SUPPORT", "FOLLOW_UP", "OTHER"]).optional(),
  waveNumber: z.coerce.number().int().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  /** Recherche sur firstName/lastName/toNumber/notes — voir listCalls dans service.ts. */
  search: z.string().optional(),
  /**
   * "queue" = ordre de traitement §P0.2 (vague → nom → prénom), utilisé par "À
   * appeler". "recent" (défaut) = plus récent d'abord, utilisé par le Journal.
   */
  sort: z.enum(["recent", "queue"]).optional().default("recent"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListCallsQuery = z.infer<typeof listCallsQuerySchema>;
