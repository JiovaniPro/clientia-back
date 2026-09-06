import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { requireParam } from "../../lib/params.js";
import { createRoleSchema, updateRoleSchema } from "./schema.js";
import * as rolesService from "./service.js";

export const rolesRouter = Router();
rolesRouter.use(authMiddleware, tenantMiddleware, requirePermission("roles.manage"));

rolesRouter.get("/", async (req, res, next) => {
  try {
    res.json(await rolesService.listRoles(req.db!));
  } catch (error) {
    next(error);
  }
});

rolesRouter.get("/permissions-catalog", async (req, res, next) => {
  try {
    res.json(await rolesService.listPermissionsCatalog(req.db!));
  } catch (error) {
    next(error);
  }
});

rolesRouter.post("/", async (req, res, next) => {
  try {
    const input = createRoleSchema.parse(req.body);
    res.status(201).json(await rolesService.createRole(req.db!, req.user!, input));
  } catch (error) {
    next(error);
  }
});

rolesRouter.patch("/:id", async (req, res, next) => {
  try {
    const input = updateRoleSchema.parse(req.body);
    res.json(await rolesService.updateRole(req.db!, req.user!, requireParam(req, "id"), input));
  } catch (error) {
    next(error);
  }
});

rolesRouter.delete("/:id", async (req, res, next) => {
  try {
    await rolesService.deleteRole(req.db!, req.user!, requireParam(req, "id"));
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});
