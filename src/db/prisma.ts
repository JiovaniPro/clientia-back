import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

// Chargé ici (et non dans index.ts) car les imports ES sont hoistés : si index.ts
// appelait loadEnvFile() après son propre import de ce module, ce serait trop tard —
// le constructeur PrismaPg ci-dessous se serait déjà exécuté avec DATABASE_URL absent.
try {
  process.loadEnvFile();
} catch {
  // pas de .env local (ex. prod où les variables sont déjà injectées) — pas bloquant
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

export const prisma = new PrismaClient({ adapter });
