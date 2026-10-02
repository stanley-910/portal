import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// dev/ahmet adds the same file (core ADR-C03) plus a `server-only` alias; on merge keep both include globs.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.mts"],
    environment: "node",
  },
});
