import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig, normalizePath, type AliasOptions } from "vite";

const workspacePackageSources = fileURLToPath(
  new URL("../../packages/*/src/**", import.meta.url),
);
const workspacePackageSource = (name: string): string =>
  fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));
const workspaceAliases: AliasOptions = [
  { find: "@ickb/core", replacement: workspacePackageSource("core") },
  { find: "@ickb/dao", replacement: workspacePackageSource("dao") },
  { find: "@ickb/order", replacement: workspacePackageSource("order") },
  { find: "@ickb/sdk", replacement: workspacePackageSource("sdk") },
  { find: "@ickb/utils", replacement: workspacePackageSource("utils") },
];
const testnetWalletMode = "testnet-wallet";
const testnetWalletGate = fileURLToPath(
  new URL("test/browser/LiveTestnetWalletHarness.tsx", import.meta.url),
);
const workspaceRoot = normalizePath(
  fileURLToPath(new URL("../../", import.meta.url)),
).replace(/\/$/u, "");
export const reactCompilerPackageExclusions = [
  "core",
  "dao",
  "order",
  "sdk",
  "utils",
].map((name) => `${workspaceRoot}/packages/${name}/src/**`);
const reactCompiler = reactCompilerPreset();
reactCompiler.rolldown.filter = {
  ...reactCompiler.rolldown.filter,
  id: {
    exclude: reactCompilerPackageExclusions,
  },
};

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => {
  const isTestnetWallet = command === "serve" && mode === testnetWalletMode;
  return {
    resolve: {
      alias: [
        ...workspaceAliases,
        ...(isTestnetWallet
          ? [{ find: "../wallet/WalletGate.tsx", replacement: testnetWalletGate }]
          : []),
      ],
    },
    server: {
      host: isTestnetWallet ? "127.0.0.1" : true,
    },
    plugins: [
      tailwindcss(),
      react(),
      babel({ presets: [reactCompiler] }),
      ...(isTestnetWallet ? [] : [basicSsl()]),
    ],
    optimizeDeps: {
      exclude: ["@ickb/core", "@ickb/dao", "@ickb/order", "@ickb/sdk", "@ickb/utils"],
    },
    build: {
      commonjsOptions: {
        include: [/node_modules/u, workspacePackageSources],
      },
    },
  };
});
