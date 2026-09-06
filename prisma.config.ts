import { defineConfig, env } from "prisma/config";

try {
  process.loadEnvFile();
} catch {
  // pas de .env local (ex. CI où les variables sont déjà injectées) — pas bloquant
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL"),
  },
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});
