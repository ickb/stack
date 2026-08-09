import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/*.{ts,tsx}", "test/{matching,scan}/*.{ts,tsx}"],
    coverage: {
      include: ["src/**/*.{ts,tsx}"],
    },
  },
});
