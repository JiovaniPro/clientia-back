export class HttpError extends Error {
  statusCode: number;
  details?: unknown;

  constructor(statusCode: number, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

export const Unauthorized = (message = "Non authentifié") => new HttpError(401, message);
export const Forbidden = (message = "Accès refusé") => new HttpError(403, message);
export const NotFound = (message = "Ressource introuvable") => new HttpError(404, message);
export const BadRequest = (message = "Requête invalide", details?: unknown) => new HttpError(400, message, details);
export const Conflict = (message = "Conflit", details?: unknown) => new HttpError(409, message, details);
