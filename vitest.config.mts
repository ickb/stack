import { defineConfig, coverageConfigDefaults } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/*"],
    coverage: {
      include: ["packages/*"],
      exclude: [...coverageConfigDefaults.exclude],
    },
  },
});
