import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "test/*.{ts,tsx}",
      "test/{conversion,transaction,state}/*/*.{ts,tsx}",
      "test/{account,error,estimate,send,withdrawal}/*.{ts,tsx}",
      "test/{core,dao,order,utils}/*.{ts,tsx}",
      "test/core/{cells,logic,owned_owner,udt}/*.{ts,tsx}",
      "test/order/{matching,scan}/*.{ts,tsx}",
    ],
    coverage: {
      include: ["src/**/*.{ts,tsx}"],
    },
  },
});
