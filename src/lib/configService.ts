import type { ScopedPrismaClient } from "../db/scopedClient.js";
import { BadRequest } from "./httpError.js";

/**
 * Lit les listes configurables et leurs drapeaux comportementaux (`metadata`).
 * C'est ce service — pas un test d'enum en dur — qui doit porter toute la logique
 * métier conditionnelle (ex: "un statut d'appel exige une date de rappel"), voir §4
 * du plan d'architecture. Construit par requête à partir du client déjà scopé.
 */
export function createConfigService(db: ScopedPrismaClient) {
  return {
    async getListItems(listKey: string) {
      return db.configurableListItem.findMany({
        where: { listKey, isActive: true },
        orderBy: { order: "asc" },
      });
    },

    async getItem(listKey: string, key: string) {
      return db.configurableListItem.findFirst({ where: { listKey, key } });
    },

    async getItemOrThrow(listKey: string, key: string) {
      const item = await this.getItem(listKey, key);
      if (!item) {
        throw BadRequest(`Valeur "${key}" inconnue pour la liste "${listKey}"`);
      }
      return item;
    },

    async getItemById(id: string) {
      return db.configurableListItem.findUnique({ where: { id } });
    },

    async getBehavior(listKey: string, key: string): Promise<Record<string, boolean>> {
      const item = await this.getItem(listKey, key);
      const metadata = item?.metadata as Record<string, boolean> | null | undefined;
      return metadata ?? {};
    },

    async getBehaviorById(id: string): Promise<Record<string, boolean>> {
      const item = await this.getItemById(id);
      const metadata = item?.metadata as Record<string, boolean> | null | undefined;
      return metadata ?? {};
    },
  };
}

export type ConfigService = ReturnType<typeof createConfigService>;
