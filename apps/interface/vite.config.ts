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
  { find: "@ickb/sdk", replacement: workspacePackageSource("sdk") },
];
const testnetWalletMode = "testnet-wallet";
const testnetWalletGate = fileURLToPath(
  new URL("test/browser/LiveTestnetWalletHarness.tsx", import.meta.url),
);
const workspaceRoot = normalizePath(
  fileURLToPath(new URL("../../", import.meta.url)),
).replace(/\/$/u, "");
export const reactCompilerPackageExclusions = [`${workspaceRoot}/packages/sdk/src/**`];
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
      exclude: ["@ickb/sdk"],
    },
    build: {
      commonjsOptions: {
        include: [/node_modules/u, workspacePackageSources],
      },
    },
  };
});
