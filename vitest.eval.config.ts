import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Pip evals: real model, real search. Slow and paid, so never part of `pnpm test`; run with `pnpm eval:pip`.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
    },
  },
  test: {
    include: ["evals/**/*.eval.ts"],
    environment: "node",
    testTimeout: 150_000,
    // one at a time: latency is part of what's measured
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
