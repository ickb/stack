import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import basicSsl from '@vitejs/plugin-basic-ssl'
import { existsSync, readFileSync } from "fs";
import { join } from "path";

// Detect if any managed fork clones are present (forks/ directory layout)
const root = join(__dirname, "../..");
const hasForkSource = (() => {
  try {
    const configPath = join(root, "forks", "config.json");
    if (!existsSync(configPath)) return false;
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    for (const [name, entry] of Object.entries<any>(config)) {
      // Managed forks have non-empty refs; reference-only clones have refs: []
      if (!Array.isArray(entry.refs) || entry.refs.length === 0) continue;
      if (existsSync(join(root, "forks", name))) return true;
    }
  } catch (err) {
    console.error("Failed to detect fork sources:", err);
  }
  return false;
})();

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: true
  },
  plugins: [
    tailwindcss(),
    react({
      // Fork source uses decorators — skip babel, let esbuild handle them
      ...(hasForkSource && { exclude: [/forks\/\w+\//] }),
      babel: {
        plugins: [["babel-plugin-react-compiler"]],
      },
    }),
    basicSsl()
  ],
  build: {
    rollupOptions: {
      // Fork source uses `export { SomeType }` instead of `export type { SomeType }`.
      // esbuild strips the type declarations but can't strip value-looking re-exports,
      // so rollup sees missing exports. Shimming is safe — they're never used at runtime.
      ...(hasForkSource && { shimMissingExports: true }),
    },
  },
});
