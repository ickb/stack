import type { JSX } from "react";
import { ActionLayout } from "../action/ActionLayout.tsx";
import RateChart from "../chart/rateChart.tsx";
import type { QuoteState } from "../query/queries.ts";
import { parseAmountInput, type RootConfig } from "../shared/utils.ts";
import { DisconnectedDashboard } from "./Dashboard.tsx";
import Form from "./Form.tsx";
import { WalletHeaderPortal } from "./WalletHeaderPortal.tsx";
import { WalletSection, WalletSections } from "./WalletSections.tsx";

export function WalletAppShell({
  rawText,
  setRawText,
  chain,
  selectChain,
  isRestoring,
  open,
  liveStatus,
  quoteState,
}: Readonly<{
  rawText: string;
  setRawText: (value: string) => void;
  chain: RootConfig["chain"];
  selectChain: (chain: RootConfig["chain"]) => void;
  isRestoring: boolean;
  open: () => void;
  liveStatus: string;
  quoteState?: QuoteState;
}>): JSX.Element {
  const isCkb2Udt = !rawText.startsWith("I");
  const amount = parseAmountInput(rawText.slice(1)).amount ?? 0n;
  const networkName = chain === "mainnet" ? "Mainnet" : "Testnet";
  const action = isRestoring ? `Restoring ${networkName} wallet` : "Connect wallet";
  const liveStatusPrefix = liveStatus !== "" ? `${liveStatus} ` : "";
  const message = `${liveStatusPrefix}This is an estimate. Wallet balance, fee, and exact availability are checked after you connect.`;

  return (
    <>
      <WalletHeaderPortal>
        <DisconnectedDashboard {...{ chain, selectChain }} />
      </WalletHeaderPortal>
      <WalletSections>
        <WalletSection>
          <Form
            {...{
              rawText,
              setRawText,
              quoteState,
              isFrozen: false,
            }}
          />
        </WalletSection>
        <WalletSection>
          <RateChart {...{ chain, isCkb2Udt, amount, quoteState }} />
        </WalletSection>
        <WalletSection>
          <ActionLayout
            action={action}
            disabled={isRestoring}
            isDone={!isRestoring}
            onAction={open}
            message={message}
            fee="..."
            maturity="..."
          />
        </WalletSection>
      </WalletSections>
    </>
  );
}
