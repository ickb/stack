import { defineConfig } from "vitest/config";

// Require branch coverage on the transaction and actor paths, without making changes to
// test doubles and presentation glue carry the same percentage obligation.
const fullCoverage = { lines: 100, functions: 100, branches: 100, statements: 100 };

export default defineConfig({
  test: {
    projects: ["sdk", "sdk/node", "testkit", "interface"],
    coverage: {
      reporter: ["text"],
      include: ["sdk/src/**/*.ts", "sdk/node/src/**/*.ts"],
      exclude: [
        // Process entrypoints are exercised by spawning them, which V8 coverage cannot see.
        "sdk/node/src/bot.ts",
        "sdk/node/src/sampler.ts",
        "sdk/node/src/stimulus.ts",
      ],
      thresholds: {
        "sdk/src/**": fullCoverage,
        "sdk/node/src/**": fullCoverage,
      },
    },
  },
});
