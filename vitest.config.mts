import { defineConfig } from "vitest/config";

// Every branch on the money path runs under a test: the SDK and the Node actors carry the
// four 100% thresholds; the test kit and the interface fail visibly, in a test or on screen,
// when they matter (decisions amendment 39(b)).
const fullCoverage = { lines: 100, functions: 100, branches: 100, statements: 100 };

export default defineConfig({
  test: {
    projects: ["packages/*", "apps/*"],
    coverage: {
      reporter: ["text"],
      include: ["packages/sdk/src/**/*.ts", "apps/node/src/**/*.ts"],
      exclude: [
        // Process entrypoints are exercised by spawning them, which V8 coverage cannot see.
        "apps/node/src/bot.ts",
        "apps/node/src/sampler.ts",
        "apps/node/src/tester.ts",
      ],
      thresholds: {
        "packages/sdk/src/**": fullCoverage,
        "apps/node/src/**": fullCoverage,
      },
    },
  },
});
