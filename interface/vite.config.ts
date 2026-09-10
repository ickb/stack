import tailwindcss from "@tailwindcss/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig, type AliasOptions } from "vite";

const workspacePackageSources = fileURLToPath(
  new URL("../{sdk,testkit}/src/**", import.meta.url),
);
const workspacePackageSource = (name: string): string =>
  fileURLToPath(new URL(`../${name}/src/index.ts`, import.meta.url));
const workspaceAliases: AliasOptions = [
  { find: "@ickb/sdk", replacement: workspacePackageSource("sdk") },
];
const testnetWalletMode = "testnet-wallet";
const testnetWalletGate = fileURLToPath(
  new URL("test/browser/LiveTestnetWalletHarness.tsx", import.meta.url),
);

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
    // The React Compiler runs natively in the plugin over the app's JSX and TSX modules.
    plugins: [
      tailwindcss(),
      react({ compiler: true }),
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
