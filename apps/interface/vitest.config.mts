import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@ickb/core": fileURLToPath(
        new URL("../../packages/core/src/index.ts", import.meta.url),
      ),
      "@ickb/dao": fileURLToPath(
        new URL("../../packages/dao/src/index.ts", import.meta.url),
      ),
      "@ickb/order": fileURLToPath(
        new URL("../../packages/order/src/index.ts", import.meta.url),
      ),
      "@ickb/sdk": fileURLToPath(
        new URL("../../packages/sdk/src/index.ts", import.meta.url),
      ),
      "@ickb/utils": fileURLToPath(
        new URL("../../packages/utils/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      include: ["src/**/*.ts"],
    },
  },
});
