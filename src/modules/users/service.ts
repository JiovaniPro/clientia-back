import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import type { ScopedPrismaClient } from "../../db/scopedClient.js";
import { AuditAction } from "../../generated/prisma/enums.js";
import { recordAuditLog } from "../../lib/auditLog.js";
import { BadRequest, Conflict, Forbidden, NotFound } from "../../lib/httpError.js";
import { buildResetLink, generateResetToken, RESET_TOKEN_TTL_HOURS, resetTokenExpiryDate } from "../../lib/passwordReset.js";
import type { AuthenticatedUser } from "../../types/express.js";
import { enqueueInternalEmail } from "../emails/service.js";
import type { CreateUserInput, ListUsersQuery, SetUserStatusInput, UpdateUserInput } from "./schema.js";

/** Permission gate elle-même — voir setUserStatus : le garde-fou "dernier admin" compte les
 * utilisateurs actifs disposant de CE droit, pas un rôle nommé "Administrateur" en dur
 * (cohérent avec les rôles dynamiques, §P0.0 — un rôle renommé ou équivalent compte aussi). */
const USER_MANAGEMENT_PERMISSION = "users.deactivate";

function sanitizeUser<T extends { password: string }>(user: T): Omit<T, "password"> {
  const { password: _password, ...rest } = user;
  return rest;
}

/** Même forme que `listUsers` (id/firstName/lastName/email/isActive/role) — le frontend
 * traite create/update/activate-désactive et la liste comme un seul DTO cohérent. */
const USER_ADMIN_INCLUDE = { role: { select: { id: true, name: true } } } as const;

async function assertRoleExists(db: ScopedPrismaClient, roleId: string) {
  const role = await db.role.findUnique({ where: { id: roleId } });
  if (!role) throw BadRequest("Rôle invalide");
}

async function assertEmailAvailable(db: ScopedPrismaClient, email: string, excludeUserId?: string) {
  const existing = await db.user.findFirst({ where: { email, ...(excludeUserId ? { id: { not: excludeUserId } } : {}) } });
  if (existing) throw Conflict("Un utilisateur utilise déjà cet e-mail");
}

/**
 * Réutilisé à la création ET à la réinitialisation (§2.2, décision actée) : dans les
 * deux cas, personne d'autre que l'utilisateur lui-même ne doit connaître son mot de
 * passe. Invalide les liens précédents non utilisés avant d'en émettre un nouveau —
 * un seul lien valide à la fois (repousse `usedAt`, pas une suppression : la ligne
 * reste comme trace, cohérent avec "jamais de suppression physique").
 */
async function issuePasswordResetLink(
  db: ScopedPrismaClient,
  target: { id: string; organizationId: string; email: string },
  opts: { isNewAccount: boolean },
) {
  await db.passwordResetToken.updateMany({
    where: { userId: target.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  const { rawToken, tokenHash } = generateResetToken();
  await db.passwordResetToken.create({
    data: { userId: target.id, tokenHash, expiresAt: resetTokenExpiryDate() },
  });

  const link = buildResetLink(rawToken);
  const subject = opts.isNewAccount
    ? "Bienvenue sur CLIENTIA — définissez votre mot de passe"
    : "Réinitialisation de votre mot de passe CLIENTIA";
  const intro = opts.isNewAccount
    ? "Un compte CLIENTIA a été créé pour vous."
    : "Une réinitialisation de votre mot de passe CLIENTIA a été demandée par un administrateur.";
  const body = `<p>${intro}</p><p>Cliquez sur ce lien pour définir votre mot de passe (valable ${RESET_TOKEN_TTL_HOURS} heures) :</p><p><a href="${link}">${link}</a></p><p>Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.</p>`;

  await enqueueInternalEmail(db, target.organizationId, { recipientUserId: target.id, subject, body });
}

/**
 * Champs volontairement limités : jamais `password`, jamais d'autre organisation
 * (scopé via `db.user`, voir db/scopedClient.ts). Gate `clients.view` OU
 * `users.view` (routes.ts) — sert à la fois l'annuaire léger (sélecteurs par nom)
 * et l'écran d'administration.
 *
 * `search` (§C2, sélecteur de participant interne) : comparaison simple
 * insensible à la casse sur prénom/nom/email pris séparément — pas de recherche
 * multi-mots sur "prénom nom" combinés (ex. "Camille Calliste" en une seule
 * requête ne matchera pas si aucun des deux champs pris seul ne contient toute la
 * chaîne), volontairement laissé simple pour ce lot minimal.
 */
export async function listUsers(db: ScopedPrismaClient, query: ListUsersQuery) {
  return db.user.findMany({
    where: {
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.role ? { role: { name: query.role } } : {}),
      ...(query.search
        ? {
            OR: [
              { firstName: { contains: query.search, mode: "insensitive" } },
              { lastName: { contains: query.search, mode: "insensitive" } },
              { email: { contains: query.search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      isActive: true,
      role: { select: { id: true, name: true } },
    },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
  });
}

/**
 * Mot de passe initial : aléatoire (32 octets), haché, jamais renvoyé ni connu de
 * l'admin qui crée le compte — même raisonnement que la réinitialisation (§2.2) :
 * personne d'autre que l'utilisateur ne doit connaître son mot de passe. Le compte
 * est donc inutilisable jusqu'à ce que le lien envoyé soit ouvert — pas un état
 * "en attente" dédié, juste une conséquence naturelle du mot de passe inconnu.
 */
export async function createUser(db: ScopedPrismaClient, actingUser: AuthenticatedUser, input: CreateUserInput) {
  await assertRoleExists(db, input.roleId);
  await assertEmailAvailable(db, input.email);

  const randomPassword = crypto.randomBytes(32).toString("hex");
  const hashedPassword = await bcrypt.hash(randomPassword, 10);

  const user = await db.user.create({
    data: {
      organizationId: actingUser.organizationId,
      email: input.email,
      password: hashedPassword,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      roleId: input.roleId,
    },
    include: USER_ADMIN_INCLUDE,
  });

  await recordAuditLog(db, { userId: actingUser.id, action: AuditAction.USER_CREATED, entity: "User", entityId: user.id });
  await issuePasswordResetLink(db, user, { isNewAccount: true });

  return sanitizeUser(user);
}

export async function updateUser(
  db: ScopedPrismaClient,
  actingUser: AuthenticatedUser,
  id: string,
  input: UpdateUserInput,
) {
  const existing = await db.user.findUnique({ where: { id } });
  if (!existing) throw NotFound("Utilisateur introuvable");
  if (input.roleId) await assertRoleExists(db, input.roleId);
  if (input.email && input.email !== existing.email) await assertEmailAvailable(db, input.email, id);

  const user = await db.user.update({
    where: { id },
    data: {
      email: input.email ?? existing.email,
      firstName: input.firstName === undefined ? existing.firstName : input.firstName,
      lastName: input.lastName === undefined ? existing.lastName : input.lastName,
      roleId: input.roleId ?? existing.roleId,
    },
    include: USER_ADMIN_INCLUDE,
  });

  await recordAuditLog(db, { userId: actingUser.id, action: AuditAction.USER_UPDATED, entity: "User", entityId: id });
  return sanitizeUser(user);
}

/**
 * Deux garde-fous impératifs (§2.2), vérifiés uniquement quand on DÉSACTIVE
 * (jamais quand on active — aucun risque à réactiver quelqu'un) :
 *
 * 1. Un utilisateur ne peut jamais se désactiver lui-même — même un admin.
 * 2. Le dernier utilisateur actif disposant de `users.deactivate` ne peut jamais
 *    être désactivé — sinon l'organisation se retrouve sans personne capable de
 *    réactiver qui que ce soit. Compté par PERMISSION, pas par nom de rôle
 *    "Administrateur" en dur : un rôle renommé ou un second rôle équivalent doit
 *    compter aussi (cohérent avec les rôles dynamiques, §P0.0). Interprétation
 *    assumée du cahier des charges ("le dernier compte administrateur actif") —
 *    signalée explicitement plutôt que décidée en silence.
 *
 * Jamais de suppression physique (§2.2) : jamais de `db.user.delete` dans ce
 * module, uniquement ce bascule de statut.
 */
export async function setUserStatus(
  db: ScopedPrismaClient,
  actingUser: AuthenticatedUser,
  id: string,
  input: SetUserStatusInput,
) {
  const existing = await db.user.findUnique({ where: { id } });
  if (!existing) throw NotFound("Utilisateur introuvable");

  if (!input.isActive) {
    if (id === actingUser.id) {
      throw Forbidden("Vous ne pouvez pas désactiver votre propre compte");
    }

    const otherActiveUsers = await db.user.findMany({
      where: { isActive: true, id: { not: id } },
      select: { role: { select: { permissions: { select: { permission: { select: { key: true } } } } } } },
    });
    const stillHasManager = otherActiveUsers.some((u) =>
      u.role.permissions.some((rp) => rp.permission.key === USER_MANAGEMENT_PERMISSION),
    );
    if (!stillHasManager) {
      throw Conflict("Impossible de désactiver le dernier utilisateur actif pouvant gérer les comptes");
    }
  }

  const user = await db.user.update({ where: { id }, data: { isActive: input.isActive }, include: USER_ADMIN_INCLUDE });
  await recordAuditLog(db, {
    userId: actingUser.id,
    action: input.isActive ? AuditAction.USER_ACTIVATED : AuditAction.USER_DEACTIVATED,
    entity: "User",
    entityId: id,
  });
  return sanitizeUser(user);
}

/** Déclenché par un admin (§2.2) — l'utilisateur cible reçoit le lien, jamais l'admin. */
export async function requestPasswordReset(db: ScopedPrismaClient, actingUser: AuthenticatedUser, id: string) {
  const existing = await db.user.findUnique({ where: { id } });
  if (!existing) throw NotFound("Utilisateur introuvable");

  await issuePasswordResetLink(db, existing, { isNewAccount: false });
  await recordAuditLog(db, {
    userId: actingUser.id,
    action: AuditAction.PASSWORD_RESET,
    entity: "User",
    entityId: id,
    meta: { triggeredBy: "admin" },
  });
}
