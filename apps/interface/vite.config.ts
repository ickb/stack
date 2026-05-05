import tailwindcss from "@tailwindcss/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const monorepoRoot = fileURLToPath(new URL("../..", import.meta.url));

// Local CCC iteration resolves built output from forks/ccc/repo, so the
// interface no longer needs the old raw-fork-source Babel/shim escape hatches.
// https://vitejs.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      "@ickb/core": fileURLToPath(
        new URL("../../packages/core/dist/index.js", import.meta.url),
      ),
      "@ickb/order": fileURLToPath(
        new URL("../../packages/order/dist/index.js", import.meta.url),
      ),
      "@ickb/sdk": fileURLToPath(
        new URL("../../packages/sdk/dist/index.js", import.meta.url),
      ),
      "@ickb/utils": fileURLToPath(
        new URL("../../packages/utils/dist/index.js", import.meta.url),
      ),
    },
  },
  server: {
    host: true,
  },
  plugins: [
    tailwindcss(),
    react({
      include: [/\.[jt]sx?$/u],
      exclude: [
        /\/packages\/core\/src\//u,
        /\/packages\/order\/src\//u,
        /\/packages\/sdk\/src\//u,
        /\/packages\/utils\/src\//u,
      ],
      babel: {
        plugins: [["babel-plugin-react-compiler"]],
      },
    }),
    basicSsl(),
  ],
  optimizeDeps: {
    exclude: ["@ickb/core", "@ickb/order", "@ickb/sdk", "@ickb/utils"],
  },
  build: {
    commonjsOptions: {
      include: [/node_modules/u, new RegExp(`${monorepoRoot}/packages/.+/dist/`)],
    },
  },
});
