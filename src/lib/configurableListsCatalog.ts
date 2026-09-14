/**
 * Catalogue des 8 listes configurables (§5.22) et de leurs drapeaux comportementaux
 * connus — source unique de vérité, dans le même esprit que permissionsCatalog.ts.
 *
 * Deux garde-fous s'appuient sur ce fichier (voir modules/configurableLists/service.ts) :
 *  - `listKey` sur un nouvel item doit être une de ces 8 clés — ce ne sont pas des
 *    catégories librement inventables : chacune correspond à une relation Prisma
 *    figée (Call.statusId, Client.dossierStatusId, etc., voir schema.prisma), un
 *    `listKey` inconnu créerait un item qu'aucun sélecteur ni aucune logique
 *    métier ne lira jamais.
 *  - toute clé de `metadata` fournie doit être un drapeau connu de CETTE liste —
 *    sinon une faute de frappe (ex. "requiresRecalDate") créerait un drapeau qui
 *    ne déclenche silencieusement rien, sans qu'aucune erreur ne le signale.
 *
 * Ajouter un drapeau comportemental : l'ajouter ici ET au point du code qui doit
 * réellement le lire (modules/calls/service.ts, modules/clients/service.ts) —
 * l'un sans l'autre ne fait rien.
 */

export const CONFIGURABLE_LIST_KEYS = [
  "CALL_STATUS",
  "CLIENT_DOSSIER_STATUS",
  "CLIENT_FINAL_STATUS",
  "CLIENT_COUNTRY",
  "CLIENT_CIVILITE",
  "CLIENT_MARITAL_STATUS",
  "CLIENT_CHILDREN",
  "CLIENT_TYPE_RDV",
] as const;

export interface BehaviorFlagDefinition {
  key: string;
  label: string;
}

export const BEHAVIOR_FLAGS_CATALOG: Record<string, BehaviorFlagDefinition[]> = {
  CALL_STATUS: [
    { key: "requiresRecallDate", label: "Nécessite une date de rappel" },
    {
      key: "triggersClientDossierCreation",
      label: "Nécessite qu'un dossier client existe déjà pour cet appel",
    },
  ],
  CLIENT_TYPE_RDV: [{ key: "requiresAddress", label: "Nécessite une adresse" }],
};

export function isKnownListKey(listKey: string): boolean {
  return (CONFIGURABLE_LIST_KEYS as readonly string[]).includes(listKey);
}

export function knownBehaviorFlagKeys(listKey: string): Set<string> {
  return new Set((BEHAVIOR_FLAGS_CATALOG[listKey] ?? []).map((f) => f.key));
}
