import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { errorHandler } from "./middleware/errorHandler.js";
import { apiRateLimit } from "./middleware/rateLimit.js";
import { auditLogRouter } from "./modules/auditLog/routes.js";
import { authRouter } from "./modules/auth/routes.js";
import { platformAuthRouter } from "./modules/platform/auth/routes.js";
import { platformAdminsRouter } from "./modules/platform/admins/routes.js";
import { platformDashboardRouter } from "./modules/platform/dashboard/routes.js";
import { platformOrganizationsRouter } from "./modules/platform/organizations/routes.js";
import { callsRouter } from "./modules/calls/routes.js";
import { calendarEventsRouter, calendarsRouter, eventCategoriesRouter } from "./modules/calendar/routes.js";
import { clientsRouter } from "./modules/clients/routes.js";
import { configurableListsRouter } from "./modules/configurableLists/routes.js";
import { customFieldsRouter } from "./modules/customFields/routes.js";
import { emailsRouter } from "./modules/emails/routes.js";
import { notificationsRouter } from "./modules/notifications/routes.js";
import { organizationsRouter } from "./modules/organizations/routes.js";
import { remindersRouter } from "./modules/reminders/routes.js";
import { reportsRouter } from "./modules/reports/routes.js";
import { rolesRouter } from "./modules/roles/routes.js";
import { settingsRouter } from "./modules/settings/routes.js";
import { usersRouter } from "./modules/users/routes.js";

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: process.env.CORS_ORIGIN?.split(",") ?? true,
      credentials: true,
    }),
  );
  app.use(express.json());
  app.use(cookieParser());
  app.use(apiRateLimit);

  /**
   * ===========================================================================
   * DÉCISION DE SÉCURITÉ : pas de protection CSRF double-submit dans cette API.
   * ===========================================================================
   *
   * Un middleware `middleware/csrf.ts` (double-submit cookie) a existé ici puis a
   * été retiré délibérément — ce n'était pas un oubli, ni un allègement de sécurité.
   *
   * Pourquoi il a été retiré :
   * Le double-submit cookie exige que le FRONT lise la valeur d'un cookie CSRF via
   * `document.cookie` pour la recopier dans un en-tête (`X-CSRF-Token`). Le backend
   * (localhost:4000) et le front (localhost:3000) sont deux origines différentes :
   * un cookie posé par :4000 est structurellement invisible à `document.cookie`
   * exécuté sur une page servie par :3000. Le mécanisme ne pouvait donc jamais
   * fonctionner tel que déployé — chaque mutation authentifiée aurait échoué en 403.
   *
   * Pourquoi ce n'est pas un problème de sécurité pour autant :
   * CSRF n'a de prise que sur un identifiant AMBIANT que le navigateur attache tout
   * seul à une requête forgée par un site tiers (typiquement un cookie de session).
   * Ici, TOUTE route métier s'authentifie exclusivement via
   *
   *     Authorization: Bearer <accessToken>
   *
   * où `accessToken` vit en mémoire JS côté front (jamais un cookie, jamais
   * localStorage — voir lib/auth/AuthContext.tsx côté front). Un site tiers forgeant
   * une requête vers cette API n'a aucun moyen de lire ou de reproduire ce header :
   * le navigateur ne l'attache jamais automatiquement. `authMiddleware`
   * (middleware/auth.ts) rejette en 401 toute requête sans ce header exact — il n'a
   * AUCUN repli sur un cookie. Le modèle bearer-token est donc intrinsèquement
   * résistant au CSRF, sans qu'il y ait de cookie ambiant à protéger.
   *
   * Les deux seules routes purement cookie-authentifiées (pas de Bearer requis) :
   *   - POST /auth/refresh
   *   - POST /auth/logout
   * Elles lisent uniquement le cookie httpOnly `refreshToken` (voir
   * modules/auth/routes.ts) posé avec `sameSite: "lax"` — ce réglage empêche déjà le
   * navigateur d'attacher ce cookie à une requête POST cross-site forgée. C'est leur
   * protection réelle, indépendante de tout mécanisme CSRF applicatif.
   *
   * RÈGLE POUR TOUTE NOUVELLE ROUTE AUTHENTIFIÉE (revue de code / futur agent) :
   *   1. Elle DOIT passer par `authMiddleware` (Authorization: Bearer) — jamais
   *      s'appuyer sur un cookie seul pour s'authentifier.
   *   2. La SEULE exception tolérée est un flux calqué sur /auth/refresh|/logout :
   *      cookie httpOnly + `sameSite: "lax"` (ou plus strict), et rien d'autre de
   *      sensible/mutation-critique ne doit dépendre uniquement de ce cookie.
   *   3. Si une future route authentifiée devait un jour accepter un cookie de
   *      session EN PLUS du Bearer (ex: SSR), la protection CSRF double-submit
   *      redeviendrait nécessaire pour cette route précise — la réintroduire alors
   *      spécifiquement, pas globalement, et vérifier qu'elle est bien lisible
   *      côté front (même origine, ou domaine parent partagé).
   */

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/auth", authRouter);
  app.use("/organizations", organizationsRouter);
  app.use("/calls", callsRouter);
  app.use("/clients", clientsRouter);
  app.use("/calendars", calendarsRouter);
  app.use("/calendar-events", calendarEventsRouter);
  app.use("/event-categories", eventCategoriesRouter);
  app.use("/reminders", remindersRouter);
  app.use("/notifications", notificationsRouter);
  app.use("/roles", rolesRouter);
  app.use("/users", usersRouter);
  app.use("/configurable-lists", configurableListsRouter);
  app.use("/custom-fields", customFieldsRouter);
  app.use("/settings", settingsRouter);
  app.use("/emails", emailsRouter);
  app.use("/reports", reportsRouter);
  app.use("/audit-logs", auditLogRouter);

  // §5.29 — jamais authMiddleware/tenantMiddleware ici (voir middleware/platformAuth.ts).
  app.use("/platform/auth", platformAuthRouter);
  app.use("/platform/organizations", platformOrganizationsRouter);
  app.use("/platform/admins", platformAdminsRouter);
  app.use("/platform/dashboard", platformDashboardRouter);

  app.use(errorHandler);

  return app;
}
