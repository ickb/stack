import tailwindcss from "@tailwindcss/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const testnetWalletMode = "testnet-wallet";
const testnetWalletGate = fileURLToPath(
  new URL("test/browser/LiveTestnetWalletHarness.tsx", import.meta.url),
);

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => {
  const isTestnetWallet = command === "serve" && mode === testnetWalletMode;
  // The live wallet harness binds to loopback only; every other serve listens on all interfaces.
  let host: string | true = true;
  if (isTestnetWallet) {
    host = "127.0.0.1";
  }
  return {
    resolve: {
      alias: isTestnetWallet
        ? [{ find: "../wallet/WalletGate.tsx", replacement: testnetWalletGate }]
        : [],
    },
    // Relative asset URLs: the bundle works at any mount point, the domain root or a
    // project path such as ickb.github.io/stack/. The app has no client-side routes.
    base: "./",
    server: { host },
    // The React Compiler runs natively in the plugin over the app's JSX and TSX modules.
    plugins: [
      tailwindcss(),
      react({ compiler: true }),
      ...(isTestnetWallet ? [] : [basicSsl()]),
    ],
    optimizeDeps: {
      exclude: ["@ickb/sdk"],
    },
  };
});
