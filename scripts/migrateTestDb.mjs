// Applique les migrations à la base de TEST (DATABASE_URL_TEST), séparée de la base
// de dev — nécessaire une fois avant de lancer `npm test`, puis à chaque nouvelle
// migration. Usage : node scripts/migrateTestDb.mjs
import { spawnSync } from "node:child_process";

try {
  process.loadEnvFile();
} catch {
  // pas de .env local
}

if (!process.env.DATABASE_URL_TEST) {
  console.error("DATABASE_URL_TEST manquant dans .env");
  process.exit(1);
}

const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL_TEST },
});

process.exit(result.status ?? 1);
