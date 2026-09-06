import { type Response, Router } from "express";
import { authMiddleware } from "../../middleware/auth.js";
import { authRateLimit } from "../../middleware/rateLimit.js";
import { Unauthorized } from "../../lib/httpError.js";
import * as authService from "./service.js";
import { loginSchema } from "./schema.js";

const REFRESH_COOKIE = "refreshToken";
const isProd = process.env.NODE_ENV === "production";

/**
 * `/refresh` et `/logout` sont les DEUX SEULES routes de cette API authentifiées
 * uniquement par ce cookie (pas de `Authorization: Bearer` requis) — c'est
 * `sameSite: "lax"` ci-dessous qui les protège du CSRF, pas un middleware dédié
 * (voir la décision de sécurité documentée dans app.ts). N'ajoute pas une nouvelle
 * route mutation-critique qui s'authentifierait uniquement via ce cookie sans
 * repasser par cette même analyse — le réflexe par défaut pour toute nouvelle route
 * authentifiée reste `authMiddleware` (Bearer), pas ce cookie.
 */
function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    path: "/auth",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

export const authRouter = Router();

authRouter.post("/login", authRateLimit, async (req, res, next) => {
  try {
    const input = loginSchema.parse(req.body);
    const { accessToken, refreshToken, user } = await authService.login(input, {
      userAgent: req.headers["user-agent"],
      ipAddress: req.ip,
    });
    setRefreshCookie(res, refreshToken);
    res.json({ accessToken, user });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/refresh", authRateLimit, async (req, res, next) => {
  try {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (!token) throw Unauthorized();
    const { accessToken, refreshToken, user } = await authService.refresh(token, {
      userAgent: req.headers["user-agent"],
      ipAddress: req.ip,
    });
    setRefreshCookie(res, refreshToken);
    res.json({ accessToken, user });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/logout", async (req, res, next) => {
  try {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (token) await authService.logout(token);
    res.clearCookie(REFRESH_COOKIE, { path: "/auth" });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

authRouter.get("/me", authMiddleware, async (req, res, next) => {
  try {
    // biome-ignore lint: authMiddleware garantit req.user
    const payload = await authService.me(req.user!.id);
    res.json(payload);
  } catch (error) {
    next(error);
  }
});
