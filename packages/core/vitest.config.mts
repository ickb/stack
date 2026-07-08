import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["{test,tests}/*.{ts,tsx}", "test/{cells,logic,owned_owner,udt}/*.{ts,tsx}"],
    coverage: {
      include: ["src/**/*.{ts,tsx}"],
    },
  },
});
