import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ccc, JoyId } from "@ckb-ccc/ccc";
import { getConfig, IckbSdk } from "@ickb/sdk";
import Connector from "./Connector.tsx";
import type { RootConfig } from "./utils.ts";
import appIcon from "/favicon.png?url";

const appName = "iCKB DApp";

function createRootConfig(chain: "mainnet" | "testnet"): RootConfig {
  const { managers, bots } = getConfig(chain);

  return {
    chain,
    queryClient: new QueryClient(),
    cccClient:
      chain === "mainnet"
        ? new ccc.ClientPublicMainnet()
        : new ccc.ClientPublicTestnet(),
    sdk: new IckbSdk(
      managers.ownedOwner,
      managers.logic,
      managers.order,
      bots,
    ),
    managers: {
      ickbUdt: managers.ickbUdt,
      logic: managers.logic,
      ownedOwner: managers.ownedOwner,
      order: managers.order,
    },
  };
}

const rootConfigs = {
  mainnet: createRootConfig("mainnet"),
  testnet: createRootConfig("testnet"),
};

export function startApp(walletChain: string): void {
  const [walletName, chain] = walletChain.split("_");
  const rootConfig = chain === "mainnet" ? rootConfigs.mainnet : rootConfigs.testnet;

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const signer = JoyId.getJoyIdSigners(
    rootConfig.cccClient,
    appName,
    ["https://ickb.org", appIcon].join(""),
  ).find((candidate) => candidate.name === "CKB")!.signer;

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
