import { Provider as CccProvider } from "@ckb-ccc/connector-react";
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, type JSX } from "react";
import { savedSelectedChain } from "../wallet/cccConnection.ts";
import { WalletGate } from "../wallet/WalletGate.tsx";
import {
  appName,
  ckbSignerOnly,
  connectorStyle,
  mainnetClient,
  queryClient,
  testnetClient,
} from "./interfaceConfig.ts";
import appIcon from "/favicon.png?url";

export default function Interface(): JSX.Element {
  const defaultChain = savedSelectedChain() ?? "mainnet";
  const defaultClient = defaultChain === "mainnet" ? mainnetClient : testnetClient;

  return (
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <CccProvider
          name={appName}
          icon={["https://ickb.org", appIcon].join("")}
          defaultClient={defaultClient}
          clientOptions={[
            { name: "Mainnet", client: mainnetClient },
            { name: "Testnet", client: testnetClient },
          ]}
          connectorProps={{
            style: connectorStyle,
          }}
          signerFilter={ckbSignerOnly}
        >
          <WalletGate />
        </CccProvider>
      </QueryClientProvider>
    </StrictMode>
  );
}
