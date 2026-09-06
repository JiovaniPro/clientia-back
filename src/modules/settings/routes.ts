import { Router } from "express";
import type { Prisma } from "../../generated/prisma/client.js";
import { authMiddleware } from "../../middleware/auth.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { requireParam } from "../../lib/params.js";
import { upsertSettingSchema } from "./schema.js";
import * as settingsService from "./service.js";

export const settingsRouter = Router();
settingsRouter.use(authMiddleware, tenantMiddleware);

settingsRouter.get("/", async (req, res, next) => {
  try {
    res.json(await settingsService.listSettings(req.db!, req.user!));
  } catch (error) {
    next(error);
  }
});

settingsRouter.put("/:key", async (req, res, next) => {
  try {
    const input = upsertSettingSchema.parse(req.body);
    res.json(
      await settingsService.upsertSetting(
        req.db!,
        req.user!,
        requireParam(req, "key"),
        input.value as Prisma.InputJsonValue,
      ),
    );
  } catch (error) {
    next(error);
  }
});
