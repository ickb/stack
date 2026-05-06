import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: ["packages/*", "apps/bot", "apps/interface", "apps/sampler", "apps/tester"],
    coverage: {
      include: ["packages/*", "apps/bot", "apps/interface", "apps/sampler", "apps/tester"],
    },
  },
});
