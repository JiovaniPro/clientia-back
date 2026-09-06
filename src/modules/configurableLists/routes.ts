import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { requireParam } from "../../lib/params.js";
import { createListItemSchema, updateListItemSchema } from "./schema.js";
import * as configurableListsService from "./service.js";

export const configurableListsRouter = Router();
configurableListsRouter.use(authMiddleware, tenantMiddleware);

// Lecture ouverte à tout utilisateur authentifié — nécessaire pour peupler les listes déroulantes.
configurableListsRouter.get("/", async (req, res, next) => {
  try {
    res.json(await configurableListsService.listAllConfigurableLists(req.db!));
  } catch (error) {
    next(error);
  }
});

configurableListsRouter.get("/:listKey", async (req, res, next) => {
  try {
    res.json(await configurableListsService.listItemsForKey(req.db!, requireParam(req, "listKey")));
  } catch (error) {
    next(error);
  }
});

configurableListsRouter.post("/", requirePermission("configurableLists.manage"), async (req, res, next) => {
  try {
    const input = createListItemSchema.parse(req.body);
    res.status(201).json(await configurableListsService.createListItem(req.db!, req.user!, input));
  } catch (error) {
    next(error);
  }
});

configurableListsRouter.patch("/items/:id", requirePermission("configurableLists.manage"), async (req, res, next) => {
  try {
    const input = updateListItemSchema.parse(req.body);
    res.json(await configurableListsService.updateListItem(req.db!, req.user!, requireParam(req, "id"), input));
  } catch (error) {
    next(error);
  }
});
