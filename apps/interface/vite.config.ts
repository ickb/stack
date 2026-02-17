import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import basicSsl from '@vitejs/plugin-basic-ssl'
import { existsSync } from "fs";

const hasCccSource = existsSync("../../ccc-dev/ccc");

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: true
  },
  plugins: [
    tailwindcss(),
    react({
      // CCC source uses decorators — skip babel, let esbuild handle them
      ...(hasCccSource && { exclude: [/\/ccc-dev\/ccc\//] }),
      babel: {
        plugins: [["babel-plugin-react-compiler"]],
      },
    }),
    basicSsl()
  ],
  build: {
    rollupOptions: {
      // CCC source uses `export { SomeType }` instead of `export type { SomeType }`.
      // esbuild strips the type declarations but can't strip value-looking re-exports,
      // so rollup sees missing exports. Shimming is safe — they're never used at runtime.
      ...(hasCccSource && { shimMissingExports: true }),
    },
  },
});
