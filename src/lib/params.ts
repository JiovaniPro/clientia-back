import type { Request } from "express";
import { BadRequest } from "./httpError.js";

/** Express 5 type `req.params[name]` comme `string | string[] | undefined` (routes à segments répétés). */
export function requireParam(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== "string") {
    throw BadRequest(`Paramètre "${name}" manquant`);
  }
  return value;
}
