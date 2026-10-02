import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// One ESM config for application and script tests. Keep both include globs.
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
