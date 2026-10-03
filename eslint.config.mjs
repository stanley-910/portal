import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // design-sync build output and staged scripts
    "ds-bundle/**",
    // nested git worktrees (.worktrees/<ledger>)
    ".worktrees/**",
    ".ds-sync/**",
    "design-system/paper-atlas/dist/**",
    // Unmodified third-party timetable evidence, never application code.
    "data/rail-capture/runs/**",
  ]),
]);

export default eslintConfig;
