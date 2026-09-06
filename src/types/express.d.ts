import type { ScopedPrismaClient } from "../db/scopedClient.js";

export interface AuthenticatedUser {
  id: string;
  organizationId: string;
  email: string;
  roleId: string;
  /** Clés de permission résolues depuis Role -> RolePermission -> Permission, à chaque requête. */
  permissions: string[];
}

declare global {
  namespace Express {
    interface Request {
      /** Posé par middleware/auth.ts */
      user?: AuthenticatedUser;
      /** Posé par middleware/tenant.ts, après auth. Client Prisma scopé — voir db/scopedClient.ts. */
      db?: ScopedPrismaClient;
    }
  }
}

export {};
