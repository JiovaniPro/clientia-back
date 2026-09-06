import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { listAuditLogsQuerySchema } from "./schema.js";
import * as auditLogService from "./service.js";

export const auditLogRouter = Router();
auditLogRouter.use(authMiddleware, tenantMiddleware, requirePermission("auditLog.view"));

auditLogRouter.get("/", async (req, res, next) => {
  try {
    const query = listAuditLogsQuerySchema.parse(req.query);
    res.json(await auditLogService.listAuditLogs(req.db!, query));
  } catch (error) {
    next(error);
  }
});
