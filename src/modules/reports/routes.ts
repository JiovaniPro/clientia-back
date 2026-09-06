import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { reportsRangeQuerySchema } from "./schema.js";
import * as reportsService from "./service.js";

export const reportsRouter = Router();
reportsRouter.use(authMiddleware, tenantMiddleware, requirePermission("reports.view"));

reportsRouter.get("/calls", async (req, res, next) => {
  try {
    const query = reportsRangeQuerySchema.parse(req.query);
    res.json(await reportsService.getCallsReport(req.db!, query));
  } catch (error) {
    next(error);
  }
});

reportsRouter.get("/clients", async (req, res, next) => {
  try {
    const query = reportsRangeQuerySchema.parse(req.query);
    res.json(await reportsService.getClientsReport(req.db!, query));
  } catch (error) {
    next(error);
  }
});

reportsRouter.get("/appointments", async (req, res, next) => {
  try {
    const query = reportsRangeQuerySchema.parse(req.query);
    res.json(await reportsService.getAppointmentsReport(req.db!, query));
  } catch (error) {
    next(error);
  }
});
