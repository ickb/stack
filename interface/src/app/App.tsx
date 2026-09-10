import { useQuery } from "@tanstack/react-query";
import { useState, type JSX } from "react";
import type { RefreshedTransactionState } from "../action/actionTransaction.ts";
import {
  createPendingTransactionStore,
  type PendingTransactionState,
} from "../action/pendingTransaction.ts";
import { l1StateOptions, type L1StateType, type QuoteState } from "../query/queries.ts";
import {
  direction2Symbol,
  errorMessageOf,
  parseAmountInput,
  symbol2Direction,
  type WalletConfig,
} from "../shared/utils.ts";
import { WalletAppView } from "../view/WalletAppView.tsx";

export default function App({
  walletConfig,
  walletName,
  openWallet,
  rawText,
  setRawText,
  quoteState,
}: Readonly<{
  walletConfig: WalletConfig;
  walletName: string;
  openWallet: () => unknown;
  rawText: string;
  setRawText: (value: string) => void;
  quoteState?: QuoteState;
}>): JSX.Element {
  const [isFrozen, freeze] = useState(false);
  // The pending transaction lives with the wallet session: it survives the action
  // remounting on a preview change and ends with this App (decisions amendment 46(i)).
  const [pendingTransaction, setPendingTransaction] = useState<PendingTransactionState>();
  const [pendingStore] = useState(() =>
    createPendingTransactionStore(setPendingTransaction),
  );
  const l1StateQuery = useQuery<L1StateType>({
    ...l1StateOptions(walletConfig, isFrozen),
  });
  const symbol = rawText.startsWith("I") ? "I" : "C";
  const isCkb2Udt = symbol2Direction(symbol);
  const amountInput = parseAmountInput(rawText.slice(1));
  const formReset = (): void => {
    setRawText(direction2Symbol(isCkb2Udt));
  };
  const l1State = l1StateQuery.data;
  const formQuoteState = l1State?.system ?? quoteState;
  const refreshPreview = async (
    refreshedIsCkb2Udt: boolean,
    refreshedAmount: bigint,
  ): Promise<RefreshedTransactionState> => {
    let result: Awaited<ReturnType<typeof l1StateQuery.refetch>>;
    try {
      result = await l1StateQuery.refetch();
    } catch (error) {
      throw new Error(`Unable to refresh wallet data: ${errorMessageOf(error)}`, {
        cause: error,
      });
    }
    if (result.error !== null) {
      throw new Error(`Unable to refresh wallet data: ${errorMessageOf(result.error)}`, {
        cause: result.error,
      });
    }
    const freshState = result.data;
    if (freshState === undefined) {
      throw new Error("Fresh wallet data is unavailable");
    }

    return {
      stateId: freshState.stateId,
      tipTimestamp: freshState.tipTimestamp,
      hasCollectable: freshState.hasCollectable,
      build: async () => freshState.txBuilder(refreshedIsCkb2Udt, refreshedAmount),
    };
  };

  return (
    <WalletAppView
      {...{
        walletConfig,
        walletName,
        openWallet,
        rawText,
        setRawText,
        quoteState,
        formQuoteState,
        isFrozen,
        isCkb2Udt,
        amount: amountInput.amount ?? 0n,
        l1State,
      }}
      actionParams={{
        isCkb2Udt,
        amount: amountInput.amount,
        amountError: amountInput.error,
        refreshPreview,
        freeze,
        formReset,
        walletConfig,
        pendingTransaction,
        pendingStore,
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
