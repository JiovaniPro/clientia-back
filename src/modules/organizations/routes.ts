import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { authRateLimit } from "../../middleware/rateLimit.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { createOrganizationSchema, updateOrganizationSchema } from "./schema.js";
import * as organizationsService from "./service.js";

export const organizationsRouter = Router();

/** Public — inscription d'une nouvelle organisation (écran (public)/register-organization). */
organizationsRouter.post("/", authRateLimit, async (req, res, next) => {
  try {
    const input = createOrganizationSchema.parse(req.body);
    const { organization, adminUser } = await organizationsService.createOrganization(input);
    res.status(201).json({
      organization: { id: organization.id, name: organization.name, slug: organization.slug },
      adminUser: { id: adminUser.id, email: adminUser.email },
    });
  } catch (error) {
    next(error);
  }
});

organizationsRouter.get("/me", authMiddleware, tenantMiddleware, async (req, res, next) => {
  try {
    res.json(await organizationsService.getCurrentOrganization(req.db!, req.user!.organizationId));
  } catch (error) {
    next(error);
  }
});

organizationsRouter.patch(
  "/me",
  authMiddleware,
  tenantMiddleware,
  requirePermission("organization.manageSettings"),
  async (req, res, next) => {
    try {
      const input = updateOrganizationSchema.parse(req.body);
      res.json(await organizationsService.updateCurrentOrganization(req.db!, req.user!, input));
    } catch (error) {
      next(error);
    }
  },
);
