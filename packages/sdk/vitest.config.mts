import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "test/*.{ts,tsx}",
      "test/{conversion,transaction,state}/*/*.{ts,tsx}",
      "test/{account,error,estimate,send,withdrawal}/*.{ts,tsx}",
    ],
    coverage: {
      include: ["src/**/*.{ts,tsx}"],
    },
  },
});
