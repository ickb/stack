import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Every file under test/ is a suite except the shared helpers beside them.
    include: ["test/**/*.{ts,tsx}"],
    exclude: ["**/support/**", "**/fixtures/**"],
    coverage: {
      include: ["src/**/*.{ts,tsx}"],
    },
  },
});
