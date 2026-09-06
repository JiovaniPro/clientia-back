import { Router } from "express";
import multer from "multer";
import { authMiddleware } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { BadRequest } from "../../lib/httpError.js";
import { requireParam } from "../../lib/params.js";
import { parseImportFile } from "./import.js";
import { changeCallStatusSchema, createCallSchema, listCallsQuerySchema, updateCallSchema } from "./schema.js";
import * as callsService from "./service.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

export const callsRouter = Router();
callsRouter.use(authMiddleware, tenantMiddleware);

callsRouter.get("/", requirePermission("calls.view"), async (req, res, next) => {
  try {
    const query = listCallsQuerySchema.parse(req.query);
    res.json(await callsService.listCalls(req.db!, req.user!, query));
  } catch (error) {
    next(error);
  }
});

callsRouter.post("/", requirePermission("calls.create"), async (req, res, next) => {
  try {
    const input = createCallSchema.parse(req.body);
    res.status(201).json(await callsService.createCall(req.db!, req.user!, input));
  } catch (error) {
    next(error);
  }
});

callsRouter.post("/import", requirePermission("calls.import"), upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) throw BadRequest("Fichier requis (champ 'file')");
    const rows = parseImportFile(req.file.buffer, req.file.originalname);
    res.status(201).json(await callsService.importCalls(req.db!, req.user!, rows));
  } catch (error) {
    next(error);
  }
});

callsRouter.get("/:id", requirePermission("calls.view"), async (req, res, next) => {
  try {
    res.json(await callsService.getCall(req.db!, req.user!, requireParam(req, "id")));
  } catch (error) {
    next(error);
  }
});

callsRouter.patch("/:id", requirePermission("calls.update"), async (req, res, next) => {
  try {
    const input = updateCallSchema.parse(req.body);
    res.json(await callsService.updateCall(req.db!, req.user!, requireParam(req, "id"), input));
  } catch (error) {
    next(error);
  }
});

callsRouter.patch("/:id/status", requirePermission("calls.update"), async (req, res, next) => {
  try {
    const input = changeCallStatusSchema.parse(req.body);
    res.json(await callsService.changeCallStatus(req.db!, req.user!, requireParam(req, "id"), input));
  } catch (error) {
    next(error);
  }
});

callsRouter.delete("/:id", requirePermission("calls.delete"), async (req, res, next) => {
  try {
    await callsService.deleteCall(req.db!, req.user!, requireParam(req, "id"));
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});
