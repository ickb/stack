import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@ickb/sdk": fileURLToPath(new URL("../sdk/src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["test/{action,app,chart,hook,shared,view,wallet}/*.{ts,tsx}"],
  },
});
