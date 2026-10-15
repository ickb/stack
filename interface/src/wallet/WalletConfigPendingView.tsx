import type { JSX } from "react";
import { ActionLayout } from "../action/ActionLayout.tsx";
import type { QuoteState } from "../app/queries.ts";
import RateChart from "../chart/RateChart.tsx";
import { errorMessageOf, parseAmountInput, type RootConfig } from "../shared/utils.ts";
import { PendingDashboard } from "../view/Dashboard.tsx";
import Form from "../view/Form.tsx";
import { WalletPage } from "../view/WalletPage.tsx";

export function WalletConfigPendingView({
  rootConfig,
  walletName,
  openWallet,
  isCkb2Udt,
  setIsCkb2Udt,
  text,
  setText,
  quoteState,
  error,
  retry,
}: Readonly<{
  rootConfig: RootConfig;
  walletName: string;
  openWallet: () => unknown;
  isCkb2Udt: boolean;
  setIsCkb2Udt: (value: boolean) => void;
  text: string;
  setText: (value: string) => void;
  quoteState?: QuoteState;
  error?: unknown;
  retry?: () => void;
}>): JSX.Element {
  const amount = parseAmountInput(text).amount ?? 0n;
  const hasError = error !== undefined;

  return (
    <WalletPage
      header={
        <PendingDashboard chain={rootConfig.chain} {...{ walletName, openWallet }} />
      }
      form={
        <Form
          {...{ isCkb2Udt, setIsCkb2Udt, text, setText }}
          exchangeRatio={quoteState?.exchangeRatio}
          isFrozen={false}
          chain={rootConfig.chain}
        />
      }
      action={
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
      }
      chart={
        <RateChart chain={rootConfig.chain} {...{ isCkb2Udt, amount, quoteState }} />
      }
    />
  );
}
