import type { RequestHandler } from "express";
import { Redis } from "ioredis";
import { RateLimiterMemory, RateLimiterRedis } from "rate-limiter-flexible";
import { HttpError } from "../lib/httpError.js";

/**
 * Bascule sur Redis si REDIS_URL est défini (partagé entre instances), sinon
 * limiteur en mémoire par process. Fail-open : une panne du backend (ex: Redis
 * injoignable) laisse passer la requête plutôt que de bloquer tout le trafic.
 */
function createRateLimiter(keyPrefix: string, points: number, durationSeconds: number): RequestHandler {
  const limiter = process.env.REDIS_URL
    ? new RateLimiterRedis({
        storeClient: new Redis(process.env.REDIS_URL, { enableOfflineQueue: false }),
        points,
        duration: durationSeconds,
        keyPrefix,
      })
    : new RateLimiterMemory({ points, duration: durationSeconds, keyPrefix });

  return async (req, _res, next) => {
    try {
      await limiter.consume(req.ip ?? "unknown");
      next();
    } catch (rejection) {
      if (rejection instanceof Error) {
        // erreur du backend du limiteur (ex: Redis indisponible) — fail-open
        next();
        return;
      }
      next(new HttpError(429, "Trop de requêtes, réessayez plus tard"));
    }
  };
}

export const apiRateLimit = createRateLimiter("rl-api", 300, 60);
export const authRateLimit = createRateLimiter("rl-auth", 10, 60);
