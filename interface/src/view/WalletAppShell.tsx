import type { JSX } from "react";
import { ActionLayout } from "../action/ActionLayout.tsx";
import type { QuoteState } from "../app/queries.ts";
import RateChart from "../chart/RateChart.tsx";
import { parseAmountInput, type RootConfig } from "../shared/utils.ts";
import { DisconnectedDashboard } from "./Dashboard.tsx";
import Form from "./Form.tsx";
import { WalletPage } from "./WalletPage.tsx";

export function WalletAppShell({
  isCkb2Udt,
  setIsCkb2Udt,
  text,
  setText,
  chain,
  selectChain,
  isRestoring,
  open,
  liveStatus,
  quoteState,
}: Readonly<{
  isCkb2Udt: boolean;
  setIsCkb2Udt: (value: boolean) => void;
  text: string;
  setText: (value: string) => void;
  chain: RootConfig["chain"];
  selectChain: (chain: RootConfig["chain"]) => void;
  isRestoring: boolean;
  open: () => void;
  liveStatus: string;
  quoteState?: QuoteState;
}>): JSX.Element {
  const amount = parseAmountInput(text).amount ?? 0n;
  const networkName = chain === "mainnet" ? "Mainnet" : "Testnet";
  const action = isRestoring ? `Restoring ${networkName} wallet` : "Connect wallet";
  const liveStatusPrefix = liveStatus !== "" ? `${liveStatus} ` : "";
  const message = `${liveStatusPrefix}This is an estimate. Wallet balance, fee, and exact availability are checked after you connect.`;

  return (
    <WalletPage
      header={<DisconnectedDashboard {...{ chain, selectChain }} />}
      form={
        <Form
          {...{ isCkb2Udt, setIsCkb2Udt, text, setText, chain }}
          exchangeRatio={quoteState?.exchangeRatio}
          isFrozen={false}
        />
      }
      action={
        <ActionLayout
          action={action}
          disabled={isRestoring}
          isDone={!isRestoring}
          onAction={open}
          message={message}
          fee="..."
          maturity="..."
        />
      }
      chart={<RateChart {...{ chain, isCkb2Udt, amount, quoteState }} />}
    />
  );
}
