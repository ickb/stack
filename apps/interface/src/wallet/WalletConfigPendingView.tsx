import type { JSX } from "react";
import { ActionLayout } from "../action/ActionLayout.tsx";
import RateChart from "../chart/rateChart.tsx";
import type { QuoteState } from "../query/queries.ts";
import {
  errorMessageOf,
  parseAmountInput,
  symbol2Direction,
  type RootConfig,
} from "../shared/utils.ts";
import { PendingDashboard } from "../view/Dashboard.tsx";
import Form from "../view/Form.tsx";
import { WalletHeaderPortal } from "../view/WalletHeaderPortal.tsx";
import { WalletSection, WalletSections } from "../view/WalletSections.tsx";

export function WalletConfigPendingView({
  rootConfig,
  walletName,
  openWallet,
  rawText,
  setRawText,
  quoteState,
  error,
  retry,
}: Readonly<{
  rootConfig: RootConfig;
  walletName: string;
  openWallet: () => unknown;
  rawText: string;
  setRawText: (value: string) => void;
  quoteState?: QuoteState;
  error?: unknown;
  retry?: () => void;
}>): JSX.Element {
  const isCkb2Udt = symbol2Direction(rawText.startsWith("I") ? "I" : "C");
  const amount = parseAmountInput(rawText.slice(1)).amount ?? 0n;
  const hasError = error !== undefined;

  return (
    <>
      <WalletHeaderPortal>
        <PendingDashboard chain={rootConfig.chain} {...{ walletName, openWallet }} />
      </WalletHeaderPortal>
      <WalletSections>
        <WalletSection>
          <Form {...{ rawText, setRawText, quoteState, isFrozen: false }} />
        </WalletSection>
        <WalletSection>
          <RateChart chain={rootConfig.chain} {...{ isCkb2Udt, amount, quoteState }} />
        </WalletSection>
        <WalletSection>
          <ActionLayout
            action={hasError ? "Retry wallet data" : "Connect wallet"}
            disabled={!hasError || retry === undefined}
            isDone={hasError}
            onAction={hasError ? retry : undefined}
            message={
              hasError
                ? `⚠️ Unable to connect to ${walletName}: ${errorMessageOf(error)}`
                : `${walletName} may ask you to authorize this connection.`
            }
            fee="..."
            maturity="..."
          />
        </WalletSection>
      </WalletSections>
    </>
  );
}
