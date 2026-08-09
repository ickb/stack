import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@ickb/node-utils": fileURLToPath(
        new URL("../node-utils/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["test/**/*.{ts,tsx}"],
    exclude: ["test/**/support.ts", "test/**/support/**"],
    coverage: {
      include: ["src/**/*.{ts,tsx}"],
    },
  },
});
