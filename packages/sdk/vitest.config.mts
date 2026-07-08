import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "{test,tests}/*.{ts,tsx}",
      "test/{conversion,transaction,state}/*/*.{ts,tsx}",
      "test/{estimate,send,withdrawal}/*.{ts,tsx}",
    ],
    coverage: {
      include: ["src/**/*.{ts,tsx}"],
    },
  },
});
