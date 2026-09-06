import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { requireParam } from "../../lib/params.js";
import { createReminderSchema, listRemindersQuerySchema, updateReminderSchema } from "./schema.js";
import * as remindersService from "./service.js";

export const remindersRouter = Router();
remindersRouter.use(authMiddleware, tenantMiddleware);

remindersRouter.get("/", requirePermission("reminders.view"), async (req, res, next) => {
  try {
    const query = listRemindersQuerySchema.parse(req.query);
    res.json(await remindersService.listReminders(req.db!, req.user!, query));
  } catch (error) {
    next(error);
  }
});

remindersRouter.post("/", requirePermission("reminders.create"), async (req, res, next) => {
  try {
    const input = createReminderSchema.parse(req.body);
    res.status(201).json(await remindersService.createReminder(req.db!, req.user!, input));
  } catch (error) {
    next(error);
  }
});

remindersRouter.patch("/:id", requirePermission("reminders.update"), async (req, res, next) => {
  try {
    const input = updateReminderSchema.parse(req.body);
    res.json(await remindersService.updateReminder(req.db!, req.user!, requireParam(req, "id"), input));
  } catch (error) {
    next(error);
  }
});

remindersRouter.delete("/:id", requirePermission("reminders.delete"), async (req, res, next) => {
  try {
    await remindersService.deleteReminder(req.db!, req.user!, requireParam(req, "id"));
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});
