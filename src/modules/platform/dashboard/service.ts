import { prisma } from "../../../db/prisma.js";

/**
 * §5.29 sous-lot 7 — agrégats globaux, tous volontairement en lecture simple
 * (`count`), pas de logique métier : c'est le seul endroit du code où compter
 * across-organisations est légitime, puisque c'est la plateforme elle-même qui
 * regarde, pas une organisation qui regarderait les autres.
 */
export async function getDashboardStats() {
  const [organizationsTotal, organizationsActive, usersTotal, callsTotal] = await Promise.all([
    prisma.organization.count(),
    prisma.organization.count({ where: { isActive: true } }),
    prisma.user.count(),
    prisma.call.count(),
  ]);

  return {
    organizations: {
      total: organizationsTotal,
      active: organizationsActive,
      suspended: organizationsTotal - organizationsActive,
    },
    users: { total: usersTotal },
    calls: { total: callsTotal },
  };
}
