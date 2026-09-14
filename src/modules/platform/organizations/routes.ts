import { Router } from "express";
import { platformAuthMiddleware } from "../../../middleware/platformAuth.js";
import { requireParam } from "../../../lib/params.js";
import { createOrganizationSchema } from "../../organizations/schema.js";
import { setOrganizationStatusSchema } from "./schema.js";
import * as platformOrganizationsService from "./service.js";

/** Toutes ces routes exigent `platformAuthMiddleware` UNIQUEMENT — jamais
 * authMiddleware/tenantMiddleware/requirePermission (voir §5.29, point 5). */
export const platformOrganizationsRouter = Router();
platformOrganizationsRouter.use(platformAuthMiddleware);

platformOrganizationsRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await platformOrganizationsService.listOrganizations());
  } catch (error) {
    next(error);
  }
});

platformOrganizationsRouter.get("/:id", async (req, res, next) => {
  try {
    res.json(await platformOrganizationsService.getOrganization(requireParam(req, "id")));
  } catch (error) {
    next(error);
  }
});

platformOrganizationsRouter.post("/", async (req, res, next) => {
  try {
    const input = createOrganizationSchema.parse(req.body);
    res.status(201).json(await platformOrganizationsService.createOrganization(input, req.platformAdmin!));
  } catch (error) {
    next(error);
  }
});

platformOrganizationsRouter.patch("/:id/status", async (req, res, next) => {
  try {
    const input = setOrganizationStatusSchema.parse(req.body);
    res.json(
      await platformOrganizationsService.setOrganizationStatus(requireParam(req, "id"), input, req.platformAdmin!),
    );
  } catch (error) {
    next(error);
  }
});
