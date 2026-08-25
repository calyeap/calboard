import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    // Integration tests share one real Postgres instance and TRUNCATE overlapping
    // tables in beforeEach; running test files in parallel races them against each
    // other. Force serial file execution so each file's setup/teardown is isolated.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
