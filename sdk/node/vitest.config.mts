import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.{ts,tsx}"],
    exclude: ["test/**/fixtures/**", "test/**/support/**"],
    coverage: {
      include: ["src/**/*.{ts,tsx}"],
    },
  },
});
