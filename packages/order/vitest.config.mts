import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["{test,tests}/*.{ts,tsx}", "test/{matching,scan}/*.{ts,tsx}"],
    coverage: {
      include: ["src/**/*.{ts,tsx}"],
    },
  },
});
