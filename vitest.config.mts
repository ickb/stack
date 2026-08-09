import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/*", "apps/*"],
    coverage: {
      reporter: ["text"],
      include: ["packages/*/src/**/*.{ts,tsx}", "apps/*/src/**/*.{ts,tsx}"],
      exclude: [
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
