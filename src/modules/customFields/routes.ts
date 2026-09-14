import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { BadRequest } from "../../lib/httpError.js";
import { requireParam } from "../../lib/params.js";
import {
  createCustomFieldDefinitionSchema,
  setCustomFieldValuesSchema,
  updateCustomFieldDefinitionSchema,
} from "./schema.js";
import * as customFieldsService from "./service.js";

export const customFieldsRouter = Router();
customFieldsRouter.use(authMiddleware, tenantMiddleware);

customFieldsRouter.get("/definitions", async (req, res, next) => {
  try {
    const entityType = req.query.entityType;
    if (typeof entityType !== "string") throw BadRequest("Paramètre entityType requis");
    // `includeInactive` sert l'écran d'administration (besoin de voir/réactiver les
    // champs désactivés) — le rendu des formulaires de saisie, lui, n'appelle jamais
    // ce paramètre et ne voit donc que les champs actifs, comme avant.
    const includeInactive = req.query.includeInactive === "true";
    res.json(await customFieldsService.listDefinitions(req.db!, entityType, { includeInactive }));
  } catch (error) {
    next(error);
  }
});

customFieldsRouter.post("/definitions", requirePermission("customFields.manage"), async (req, res, next) => {
  try {
    const input = createCustomFieldDefinitionSchema.parse(req.body);
    res.status(201).json(await customFieldsService.createDefinition(req.db!, req.user!, input));
  } catch (error) {
    next(error);
  }
});

customFieldsRouter.patch("/definitions/:id", requirePermission("customFields.manage"), async (req, res, next) => {
  try {
    const input = updateCustomFieldDefinitionSchema.parse(req.body);
    res.json(await customFieldsService.updateDefinition(req.db!, req.user!, requireParam(req, "id"), input));
  } catch (error) {
    next(error);
  }
});

customFieldsRouter.delete("/definitions/:id", requirePermission("customFields.manage"), async (req, res, next) => {
  try {
    await customFieldsService.deleteDefinition(req.db!, req.user!, requireParam(req, "id"));
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// Valeurs : pas de permission dédiée — accessibles à qui peut déjà atteindre l'entité
// ciblée (vérifié dans le service via assertEntityBelongsToOrg).
customFieldsRouter.get("/values/:entityType/:entityId", async (req, res, next) => {
  try {
    res.json(
      await customFieldsService.getValuesForEntity(
        req.db!,
        requireParam(req, "entityType"),
        requireParam(req, "entityId"),
      ),
    );
  } catch (error) {
    next(error);
  }
});

customFieldsRouter.put("/values/:entityType/:entityId", async (req, res, next) => {
  try {
    const input = setCustomFieldValuesSchema.parse(req.body);
    res.json(
      await customFieldsService.setValuesForEntity(
        req.db!,
        requireParam(req, "entityType"),
        requireParam(req, "entityId"),
        input,
      ),
    );
  } catch (error) {
    next(error);
  }
});
