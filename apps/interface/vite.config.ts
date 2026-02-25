import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import basicSsl from '@vitejs/plugin-basic-ssl'
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";

// Detect if any managed fork clones are present
const root = join(__dirname, "../..");
const hasForkSource = (() => {
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.endsWith("-fork")) continue;
      const configPath = join(root, entry.name, "config.json");
      if (!existsSync(configPath)) continue;
      const { cloneDir } = JSON.parse(readFileSync(configPath, "utf8"));
      if (!cloneDir) continue;
      if (existsSync(join(root, entry.name, cloneDir))) return true;
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
      ...(hasForkSource && { exclude: [/\w+-fork\/\w+\//] }),
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
