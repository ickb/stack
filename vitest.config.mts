import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/*", "apps/bot", "apps/interface", "apps/sampler", "apps/supervisor", "apps/tester"],
    coverage: {
      include: ["packages/*", "apps/bot", "apps/interface", "apps/sampler", "apps/supervisor", "apps/tester"],
    },
  },
});
