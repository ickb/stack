import { useQuery } from "@tanstack/react-query";
import { useState, type JSX } from "react";
import { confirmPreviewMessage } from "../action/actionStatus.ts";
import {
  transact,
  type AttemptPhase,
  type RefreshedTransactionPreview,
} from "../action/actionTransaction.ts";
import { errorMessageOf, parseAmountInput, type WalletConfig } from "../shared/utils.ts";
import { WalletAppView } from "../view/WalletAppView.tsx";
import { l1StateOptions, type L1StateType, type QuoteState } from "./queries.ts";

export default function App({
  walletConfig,
  walletName,
  openWallet,
  isCkb2Udt,
  setIsCkb2Udt,
  text,
  setText,
  quoteState,
}: Readonly<{
  walletConfig: WalletConfig;
  walletName: string;
  openWallet: () => unknown;
  isCkb2Udt: boolean;
  setIsCkb2Udt: (value: boolean) => void;
  text: string;
  setText: (value: string) => void;
  quoteState?: QuoteState;
}>): JSX.Element {
  const amountInput = parseAmountInput(text);
  // The attempt lives with the wallet session, not with the action view: a remount of the
  // view neither stops a commit nor loses what it shows.
  const [phase, setPhase] = useState<AttemptPhase>("idle");
  // Shown only while an attempt prepares or holds a preview, and each attempt sets it first.
  // Stryker disable next-line StringLiteral: see above.
  const [message, setMessage] = useState("");
  const [frozenPreview, setFrozenPreview] = useState<RefreshedTransactionPreview>();
  // The last attempt's failure, kept until the next attempt or an edit of the draft: React's
  // pattern for state that depends on a prop, so a stale "enter a larger amount" never
  // advises on a draft the user has already changed.
  const draft = `${String(isCkb2Udt)}:${String(amountInput.amount)}`;
  // Any first value is replaced, on the first render, by this draft's empty failure.
  // Stryker disable next-line ObjectLiteral: see above.
  const [failure, setFailureFor] = useState({ draft, message: "" });
  if (failure.draft !== draft) {
    setFailureFor({ draft, message: "" });
  }
  // The draft and the account read hold still from the click to the commit's last step.
  const isFrozen = phase !== "idle";
  const l1StateQuery = useQuery<L1StateType>({
    ...l1StateOptions(walletConfig, isFrozen),
  });
  const formReset = (): void => {
    setText("");
  };
  const l1State = l1StateQuery.data;
  const refreshState = async (): Promise<L1StateType> => {
    // Without throwOnError the refetch resolves with the query's error instead of throwing.
    const result = await l1StateQuery.refetch();
    if (result.error !== null) {
      throw new Error(`Unable to refresh wallet data: ${errorMessageOf(result.error)}`, {
        cause: result.error,
      });
    }
    if (result.data === undefined) {
      throw new Error("Fresh wallet data is unavailable");
    }
    return result.data;
  };

  return (
    <WalletAppView
      {...{
        walletConfig,
        walletName,
        openWallet,
        isCkb2Udt,
        setIsCkb2Udt,
        text,
        setText,
        quoteState,
        // The wallet's own sampled ratio quotes the form once the account state is in.
        exchangeRatio: l1State?.exchangeRatio ?? quoteState?.exchangeRatio,
        isFrozen,
        amount: amountInput.amount ?? 0n,
        l1State,
      }}
      actionParams={{
        isCkb2Udt,
        amount: amountInput.amount,
        amountError: amountInput.error,
        walletConfig,
        attempt: { phase, message, failure: failure.message, frozenPreview },
        onAction: () => {
          const { amount } = amountInput;
          if (amount === undefined) {
            return;
          }
          void transact({
            refreshState,
            isCkb2Udt,
            amount,
            freezePreview: (preview) => {
              setFrozenPreview(preview);
              if (preview !== undefined) {
                setMessage(confirmPreviewMessage(preview));
              }
            },
            setMessage,
            setFailure: (failureText) => {
              setFailureFor({ draft, message: failureText });
            },
            setPhase,
            formReset,
            walletConfig,
          });
        },
        l1State,
        isStateFetching: l1StateQuery.isFetching,
        stateError: l1StateQuery.error,
        retryState: () => {
          void l1StateQuery.refetch();
        },
      }}
    />
  );
}
