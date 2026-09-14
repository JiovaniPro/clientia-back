import type { ScopedPrismaClient } from "../db/scopedClient.js";

export interface AuthenticatedUser {
  id: string;
  organizationId: string;
  email: string;
  roleId: string;
  /** Clés de permission résolues depuis Role -> RolePermission -> Permission, à chaque requête. */
  permissions: string[];
}

/**
 * §5.29 — délibérément SANS `organizationId` : un Super Admin n'appartient à
 * aucune organisation. Cette absence est ce qui rend une confusion avec
 * `AuthenticatedUser` détectable à la compilation, pas seulement à l'exécution —
 * voir middleware/platformAuth.ts et le point 5 de la proposition §5.29.
 */
export interface AuthenticatedPlatformAdmin {
  id: string;
  email: string;
}

declare global {
  namespace Express {
    interface Request {
      /** Posé par middleware/auth.ts */
      user?: AuthenticatedUser;
      /** Posé par middleware/tenant.ts, après auth. Client Prisma scopé — voir db/scopedClient.ts. */
      db?: ScopedPrismaClient;
      /** Posé par middleware/platformAuth.ts UNIQUEMENT — jamais mélangé avec `user`/`db`
       * ci-dessus. Les routes `/platform/*` ne montent jamais authMiddleware/tenantMiddleware. */
      platformAdmin?: AuthenticatedPlatformAdmin;
    }
  }
}

export {};
