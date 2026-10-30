import type { JSX, ReactNode } from "react";
import type { QuoteState } from "../app/queries.ts";
import RateChart from "../chart/RateChart.tsx";
import { parseAmountInput, type RootConfig } from "../shared/utils.ts";
import Form from "./Form.tsx";
import { WalletPage } from "./WalletPage.tsx";

/**
 * The wallet page before the wallet's data is read: the draft quoted at the live rate,
 * under the caller's header and action.
 */
export function QuotePage({
  isCkb2Udt,
  setIsCkb2Udt,
  text,
  setText,
  chain,
  quoteState,
  header,
  action,
}: Readonly<{
  isCkb2Udt: boolean;
  setIsCkb2Udt: (value: boolean) => void;
  text: string;
  setText: (value: string) => void;
  chain: RootConfig["chain"];
  quoteState?: QuoteState;
  header: ReactNode;
  action: ReactNode;
}>): JSX.Element {
  const amount = parseAmountInput(text).amount ?? 0n;
  return (
    <WalletPage
      header={header}
      form={
        <Form
          {...{ isCkb2Udt, setIsCkb2Udt, text, setText, chain }}
          exchangeRatio={quoteState?.exchangeRatio}
          isFrozen={false}
        />
      }
      action={action}
      chart={<RateChart {...{ chain, isCkb2Udt, amount, quoteState }} />}
    />
  );
}
