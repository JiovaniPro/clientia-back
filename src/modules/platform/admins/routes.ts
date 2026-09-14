import { Router } from "express";
import { platformAuthMiddleware } from "../../../middleware/platformAuth.js";
import { requireParam } from "../../../lib/params.js";
import { createPlatformAdminSchema, setPlatformAdminStatusSchema, updatePlatformAdminSchema } from "./schema.js";
import * as platformAdminsService from "./service.js";

/** Comme les routes organisations plateforme : `platformAuthMiddleware` seul,
 * jamais authMiddleware/tenantMiddleware/requirePermission. */
export const platformAdminsRouter = Router();
platformAdminsRouter.use(platformAuthMiddleware);

platformAdminsRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await platformAdminsService.listAdmins());
  } catch (error) {
    next(error);
  }
});

platformAdminsRouter.post("/", async (req, res, next) => {
  try {
    const input = createPlatformAdminSchema.parse(req.body);
    res.status(201).json(await platformAdminsService.createAdmin(input));
  } catch (error) {
    next(error);
  }
});

platformAdminsRouter.patch("/:id", async (req, res, next) => {
  try {
    const input = updatePlatformAdminSchema.parse(req.body);
    res.json(await platformAdminsService.updateAdmin(requireParam(req, "id"), input));
  } catch (error) {
    next(error);
  }
});

platformAdminsRouter.patch("/:id/status", async (req, res, next) => {
  try {
    const input = setPlatformAdminStatusSchema.parse(req.body);
    res.json(await platformAdminsService.setAdminStatus(requireParam(req, "id"), input, req.platformAdmin!));
  } catch (error) {
    next(error);
  }
});
