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
    // .claude/worktrees/** holds separate, independently-checked-out git worktrees
    // (each with its own node_modules and possibly-stale source) — without this
    // exclude, vitest's default glob picks up their *.test.ts files too and runs
    // them against THIS checkout's compiled deps, producing failures that have
    // nothing to do with the code under test here.
    exclude: ["**/node_modules/**", "**/.git/**", ".claude/worktrees/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  esbuild: {
    jsx: "automatic",
  },
});
