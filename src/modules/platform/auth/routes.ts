import { type Response, Router } from "express";
import { platformAuthMiddleware } from "../../../middleware/platformAuth.js";
import { authRateLimit } from "../../../middleware/rateLimit.js";
import { Unauthorized } from "../../../lib/httpError.js";
import { changePlatformAdminPasswordSchema, platformLoginSchema } from "./schema.js";
import * as platformService from "./service.js";

/** Nom ET chemin de cookie distincts de `refreshToken`/"/auth" (voir auth/routes.ts)
 * — même navigateur, mais aucun des deux cookies n'est jamais envoyé sur les routes
 * de l'autre, en plus des secrets JWT déjà séparés. */
const PLATFORM_REFRESH_COOKIE = "platformRefreshToken";
const isProd = process.env.NODE_ENV === "production";

function setPlatformRefreshCookie(res: Response, token: string) {
  res.cookie(PLATFORM_REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    path: "/platform/auth",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

export const platformAuthRouter = Router();

platformAuthRouter.post("/login", authRateLimit, async (req, res, next) => {
  try {
    const input = platformLoginSchema.parse(req.body);
    const { accessToken, refreshToken, platformAdmin } = await platformService.login(input, {
      userAgent: req.headers["user-agent"],
      ipAddress: req.ip,
    });
    setPlatformRefreshCookie(res, refreshToken);
    res.json({ accessToken, platformAdmin });
  } catch (error) {
    next(error);
  }
});

platformAuthRouter.post("/refresh", authRateLimit, async (req, res, next) => {
  try {
    const token = req.cookies?.[PLATFORM_REFRESH_COOKIE];
    if (!token) throw Unauthorized();
    const { accessToken, refreshToken, platformAdmin } = await platformService.refresh(token, {
      userAgent: req.headers["user-agent"],
      ipAddress: req.ip,
    });
    setPlatformRefreshCookie(res, refreshToken);
    res.json({ accessToken, platformAdmin });
  } catch (error) {
    next(error);
  }
});

platformAuthRouter.post("/logout", async (req, res, next) => {
  try {
    const token = req.cookies?.[PLATFORM_REFRESH_COOKIE];
    if (token) await platformService.logout(token);
    res.clearCookie(PLATFORM_REFRESH_COOKIE, { path: "/platform/auth" });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

platformAuthRouter.get("/me", platformAuthMiddleware, async (req, res, next) => {
  try {
    const payload = await platformService.me(req.platformAdmin!.id);
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

platformAuthRouter.post("/change-password", platformAuthMiddleware, async (req, res, next) => {
  try {
    const input = changePlatformAdminPasswordSchema.parse(req.body);
    await platformService.changeOwnPassword(req.platformAdmin!.id, input.currentPassword, input.newPassword);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});
