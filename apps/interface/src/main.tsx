import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Connector from "./Connector.tsx";
import { getIckbScriptConfigs } from "@ickb/v1-core";
import { chainConfigFrom } from "@ickb/lumos-utils";
import { prefetchData } from "./queries.ts";
import { ccc, JoyId } from "@ckb-ccc/ccc";
import appIcon from "/favicon.png?url";
const appName = "iCKB DApp";

const testnetRootConfigPromise = chainConfigFrom(
  "testnet",
  "https://testnet.ckb.dev/",
  true,
  getIckbScriptConfigs,
).then((chainConfig) => {
  const rootConfig = {
    ...chainConfig,
    queryClient: new QueryClient(),
    cccClient: new ccc.ClientPublicTestnet(),
  };
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  prefetchData(rootConfig);
  return rootConfig;
});

const mainnetRootConfigPromise = chainConfigFrom(
  "mainnet",
  "https://mainnet.ckb.dev/",
  true,
  getIckbScriptConfigs,
).then((chainConfig) => {
  const rootConfig = {
    ...chainConfig,
    queryClient: new QueryClient(),
    cccClient: new ccc.ClientPublicMainnet(),
  };
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  prefetchData(rootConfig);
  return rootConfig;
});

export async function startApp(wallet_chain: string): Promise<void> {
  const [walletName, chain] = wallet_chain.split("_");
  const rootConfig = await (chain === "mainnet"
    ? mainnetRootConfigPromise
    : testnetRootConfigPromise);

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const signer = JoyId.getJoyIdSigners(
    rootConfig.cccClient,
    appName,
    ["https://ickb.org", appIcon].join(""),
  ).find((i) => i.name === "CKB")!.signer;

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const rootElement = document.getElementById("app")!;
  const root = createRoot(rootElement);
  rootElement.textContent = "";
  root.render(
    <StrictMode>
      <QueryClientProvider client={rootConfig.queryClient}>
        <Connector {...{ rootConfig, signer, walletName }} />
      </QueryClientProvider>
    </StrictMode>,
  );
}
