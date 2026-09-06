import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/*", "apps/*"],
    coverage: {
      reporter: ["text"],
      include: ["packages/*/src/**/*.{ts,tsx}", "apps/*/src/**/*.{ts,tsx}"],
      exclude: [
        // Process entrypoints are exercised by spawning them, which V8 coverage cannot see.
        "apps/node/src/bot.ts",
        "apps/node/src/sampler.ts",
        "apps/node/src/tester.ts",
        "**/test/**",
        "**/*.test.{ts,tsx}",
        "**/*TestFixtures.{ts,tsx}",
        "**/*TestSupport.{ts,tsx}",
        "**/*_test_constants.{ts,tsx}",
        "**/*_test_fixtures.{ts,tsx}",
        "**/*_test_support.{ts,tsx}",
        "**/*_test_*.{ts,tsx}",
        "**/vite-env.d.ts",
      ],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
});
