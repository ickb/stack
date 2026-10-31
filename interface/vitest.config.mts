import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/{action,app,chart,hook,shared,view,wallet}/*.{ts,tsx}"],
  },
});
