import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { requireParam } from "../../lib/params.js";
import { createEmailTemplateSchema, sendEmailSchema, updateEmailTemplateSchema } from "./schema.js";
import * as emailsService from "./service.js";

export const emailsRouter = Router();
emailsRouter.use(authMiddleware, tenantMiddleware);

emailsRouter.get("/templates", requirePermission("emails.manageTemplates"), async (req, res, next) => {
  try {
    res.json(await emailsService.listTemplates(req.db!));
  } catch (error) {
    next(error);
  }
});

emailsRouter.post("/templates", requirePermission("emails.manageTemplates"), async (req, res, next) => {
  try {
    const input = createEmailTemplateSchema.parse(req.body);
    res.status(201).json(await emailsService.createTemplate(req.db!, req.user!, input));
  } catch (error) {
    next(error);
  }
});

emailsRouter.patch("/templates/:id", requirePermission("emails.manageTemplates"), async (req, res, next) => {
  try {
    const input = updateEmailTemplateSchema.parse(req.body);
    res.json(await emailsService.updateTemplate(req.db!, req.user!, requireParam(req, "id"), input));
  } catch (error) {
    next(error);
  }
});

emailsRouter.delete("/templates/:id", requirePermission("emails.manageTemplates"), async (req, res, next) => {
  try {
    await emailsService.deleteTemplate(req.db!, req.user!, requireParam(req, "id"));
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

emailsRouter.get("/history", requirePermission("emails.viewHistory"), async (req, res, next) => {
  try {
    const clientId = typeof req.query.clientId === "string" ? req.query.clientId : undefined;
    res.json(await emailsService.listHistory(req.db!, clientId));
  } catch (error) {
    next(error);
  }
});

emailsRouter.post("/send", requirePermission("emails.send"), async (req, res, next) => {
  try {
    const input = sendEmailSchema.parse(req.body);
    res.status(201).json(await emailsService.sendManualEmail(req.db!, req.user!, input));
  } catch (error) {
    next(error);
  }
});
