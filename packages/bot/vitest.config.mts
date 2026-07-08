import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["{test,tests}/**/*.{ts,tsx}"],
    exclude: ["{test,tests}/**/fixtures/**"],
    coverage: {
      include: ["src/**/*.{ts,tsx}"],
    },
  },
});
