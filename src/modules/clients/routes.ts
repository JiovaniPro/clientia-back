import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.js";
import { requireAnyPermission, requirePermission } from "../../middleware/requirePermission.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { requireParam } from "../../lib/params.js";
import { createClientSchema, listClientsQuerySchema, updateClientSchema } from "./schema.js";
import * as clientsService from "./service.js";

export const clientsRouter = Router();
clientsRouter.use(authMiddleware, tenantMiddleware);

clientsRouter.get("/", requirePermission("clients.view"), async (req, res, next) => {
  try {
    const query = listClientsQuerySchema.parse(req.query);
    res.json(await clientsService.listClients(req.db!, req.user!, query));
  } catch (error) {
    next(error);
  }
});

clientsRouter.post("/", requirePermission("clients.create"), async (req, res, next) => {
  try {
    const input = createClientSchema.parse(req.body);
    res.status(201).json(await clientsService.createClient(req.db!, req.user!, input));
  } catch (error) {
    next(error);
  }
});

clientsRouter.get("/:id", requirePermission("clients.view"), async (req, res, next) => {
  try {
    res.json(await clientsService.getClient(req.db!, req.user!, requireParam(req, "id")));
  } catch (error) {
    next(error);
  }
});

clientsRouter.patch(
  "/:id",
  requireAnyPermission(["clients.update", "clients.editFinalStatus"]),
  async (req, res, next) => {
    try {
      const input = updateClientSchema.parse(req.body);
      res.json(await clientsService.updateClient(req.db!, req.user!, requireParam(req, "id"), input));
    } catch (error) {
      next(error);
    }
  },
);

clientsRouter.delete("/:id", requirePermission("clients.delete"), async (req, res, next) => {
  try {
    await clientsService.deleteClient(req.db!, req.user!, requireParam(req, "id"));
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});
