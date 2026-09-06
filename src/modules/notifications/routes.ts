import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { requireParam } from "../../lib/params.js";
import { listNotificationsQuerySchema } from "./schema.js";
import * as notificationsService from "./service.js";

export const notificationsRouter = Router();
notificationsRouter.use(authMiddleware, tenantMiddleware, requirePermission("notifications.view"));

notificationsRouter.get("/", async (req, res, next) => {
  try {
    const query = listNotificationsQuerySchema.parse(req.query);
    res.json(await notificationsService.listNotifications(req.db!, req.user!, query));
  } catch (error) {
    next(error);
  }
});

notificationsRouter.patch("/:id/read", async (req, res, next) => {
  try {
    res.json(await notificationsService.markAsRead(req.db!, req.user!, requireParam(req, "id")));
  } catch (error) {
    next(error);
  }
});

notificationsRouter.post("/read-all", async (req, res, next) => {
  try {
    await notificationsService.markAllAsRead(req.db!, req.user!);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});
