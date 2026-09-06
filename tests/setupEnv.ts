try {
  process.loadEnvFile();
} catch {
  // pas de .env local (ex. CI où les variables sont déjà injectées) — pas bloquant
}

// Les tests ne doivent jamais toucher la base de développement.
if (process.env.DATABASE_URL_TEST) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
}
