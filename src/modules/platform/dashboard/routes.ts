import { Router } from "express";
import { platformAuthMiddleware } from "../../../middleware/platformAuth.js";
import * as platformDashboardService from "./service.js";

export const platformDashboardRouter = Router();
platformDashboardRouter.use(platformAuthMiddleware);

platformDashboardRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await platformDashboardService.getDashboardStats());
  } catch (error) {
    next(error);
  }
});
