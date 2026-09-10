import { defineConfig } from "vitest/config";

// Every branch on the money path runs under a test: the SDK and the Node actors carry the
// four 100% thresholds; the test kit and the interface fail visibly, in a test or on screen,
// when they matter (decisions amendment 39(b)).
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
