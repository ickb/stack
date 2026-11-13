import { Provider as CccProvider } from "@ckb-ccc/connector-react";
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, type JSX } from "react";
import { WalletGate } from "../wallet/WalletGate.tsx";
import {
  appName,
  connectorStyle,
  mainnetClient,
  queryClient,
  testnetClient,
} from "./interfaceConfig.ts";
import appIcon from "/favicon.png?url";

export default function Interface(): JSX.Element {
  return (
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <CccProvider
          name={appName}
          icon={`https://ickb.org${appIcon}`}
          // The app lands on mainnet; the connector's network list switches it.
          defaultClient={mainnetClient}
          clientOptions={[
            { name: "Mainnet", client: mainnetClient },
            { name: "Testnet", client: testnetClient },
          ]}
          connectorProps={{
            style: connectorStyle,
          }}
        >
          <WalletGate />
        </CccProvider>
      </QueryClientProvider>
    </StrictMode>
  );
}
