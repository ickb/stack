import { useQuery } from "@tanstack/react-query";
import { useState, type JSX } from "react";
import type { RefreshedTransactionState } from "../action/actionTransaction.ts";
import { useDestination, type Destination } from "../action/destination.ts";
import {
  createPendingTransactionStore,
  type PendingTransactionState,
} from "../action/pendingTransaction.ts";
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
  const [isFrozen, freeze] = useState(false);
  // The destination of the next transaction, the wallet's own address while empty; it
  // lives with this App, so a reload or a wallet switch resets it (amendment 52(af)).
  const [destinationText, setDestinationText] = useState("");
  const { destination, error: destinationError } = useDestination(
    destinationText,
    walletConfig,
  );
  // The pending transaction lives with the wallet session: it survives the action
  // remounting on a preview change and ends with this App (decisions amendment 46(i)).
  const [pendingTransaction, setPendingTransaction] = useState<PendingTransactionState>();
  const [pendingStore] = useState(() =>
    createPendingTransactionStore(setPendingTransaction),
  );
  const l1StateQuery = useQuery<L1StateType>({
    ...l1StateOptions(walletConfig, isFrozen),
  });
  // A move carries only native CKB and iCKB and converts nothing, so its amount is zero;
  // the typed text stays, and clearing the address brings it back (amendment 52(al)).
  const isMove = destination?.moveTo !== undefined;
  const draft = isMove ? "0" : text;
  const amountInput = parseAmountInput(draft);
  const formReset = (): void => {
    setText("");
  };
  const l1State = l1StateQuery.data;
  const refreshPreview = async (
    refreshedIsCkb2Udt: boolean,
    refreshedAmount: bigint,
    refreshedDestination: Destination,
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
      tipTimestamp: freshState.system.tip.timestamp,
      hasCollectable: freshState.hasCollectable,
      build: async () =>
        freshState.txBuilder(refreshedIsCkb2Udt, refreshedAmount, refreshedDestination),
    };
  };

  return (
    <WalletAppView
      {...{
        walletConfig,
        walletName,
        openWallet,
        isCkb2Udt,
        setIsCkb2Udt,
        text: draft,
        setText,
        quoteState,
        // The wallet's own sampled ratio quotes the form once the account state is in.
        exchangeRatio: l1State?.system.exchangeRatio ?? quoteState?.exchangeRatio,
        isFrozen,
        amount: amountInput.amount ?? 0n,
        l1State,
      }}
      destinationField={{
        text: destinationText,
        setText: setDestinationText,
        isValid: destination !== undefined,
        isForeign: isMove,
      }}
      actionParams={{
        isCkb2Udt,
        amount: amountInput.amount,
        amountError: amountInput.error,
        destination,
        destinationError,
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
