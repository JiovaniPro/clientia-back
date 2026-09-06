import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setupEnv.ts"],
    testTimeout: 20000,
    hookTimeout: 20000,
    // En série : plusieurs fichiers de test créent/lisent des organisations sur la
    // même base de test, pas la peine de paralléliser tant que la suite reste petite.
    fileParallelism: false,
  },
});
