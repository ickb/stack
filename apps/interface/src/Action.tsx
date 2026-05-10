import { useQuery } from "@tanstack/react-query";
import { useState, type JSX } from "react";
import { sendAndWaitForCommit } from "@ickb/sdk";
import { getL1State, type L1StateType } from "./queries.ts";
import Progress from "./Progress.tsx";
import {
  errorMessageOf,
  hasTransactionActivity,
  toText,
  txInfoPadding,
  type TxInfo,
  type WalletConfig,
} from "./utils.ts";

export default function Action({
  isCkb2Udt,
  amount,
  freeze,
  formReset,
  walletConfig,
  l1State,
  isStateFetching,
}: {
  isCkb2Udt: boolean;
  amount: bigint;
  freeze: (value: boolean) => void;
  formReset: () => void;
  walletConfig: WalletConfig;
  l1State: L1StateType | undefined;
  isStateFetching: boolean;
}): JSX.Element {
  const [message, setMessage] = useState("");
  const [failure, setFailure] = useState("");
  const [frozenTxInfo, setFrozenTxInfoState] = useState(txInfoPadding);
  const freezeTxInfo = (txInfo: TxInfo): void => {
    setFrozenTxInfoState(txInfo);
    freeze(txInfo !== txInfoPadding);
  };

  const isFrozen = frozenTxInfo !== txInfoPadding;
  const stateId = l1State?.stateId ?? "missing";
  const txPreviewQuery = useQuery({
    queryKey: [
      walletConfig.chain,
      walletConfig.address,
      "txInfo",
      stateId,
      isCkb2Udt,
      amount.toString(),
    ],
    queryFn: () => {
      if (!l1State) {
        throw new Error("Missing L1 state");
      }

      return l1State.txBuilder(isCkb2Udt, amount);
    },
    enabled: !isFrozen && l1State !== undefined,
    retry: false,
  });

  if (!l1State) {
    return <span className="grid grid-cols-2 items-center justify-items-center gap-y-4" />;
  }

  const txInfo = isFrozen ? frozenTxInfo : txPreviewQuery.data ?? txInfoPadding;
  const isFetching = isStateFetching || txPreviewQuery.isFetching;
  const isValid =
    hasTransactionActivity(txInfo.tx) && txInfo.fee > 0n && txInfo.error === "";
  const { maturity, isReady } = timeUntilMaturity(
    txInfo.estimatedMaturity,
    l1State.tipTimestamp,
  );

  return (
    <span className="grid grid-cols-2 items-center justify-items-center gap-y-4">
      <Progress isDone={!isFetching && !isFrozen}>
        <button
          className="text-s col-span-2 min-h-12 w-full cursor-pointer rounded border-2 border-amber-400 px-8 leading-relaxed font-bold tracking-wider text-amber-400 uppercase disabled:cursor-default disabled:opacity-50"
          onClick={() => {
            void transact(
              () => getL1State(walletConfig).then((freshState) =>
                freshState.txBuilder(isCkb2Udt, amount)
              ),
              txInfo,
              freezeTxInfo,
              setMessage,
              setFailure,
              formReset,
              walletConfig,
            );
          }}
          disabled={isFetching || isFrozen || !isValid}
        >
          {isFrozen
            ? message
            : isFetching
              ? "building preview..."
              : txInfo.error !== ""
                ? txInfo.error
                : !isValid
                  ? "nothing to do right now"
                  : amount > 0n
                    ? `request conversion to ${isCkb2Udt ? "iCKB" : "CKB"}`
                    : `${isReady ? "fully" : "partially"} collect converted funds`}
        </button>
      </Progress>
      {failure !== "" ? <span className="col-span-2 text-center text-red-400">{failure}</span> : null}
      <span className="leading-relaxed font-bold tracking-wider">Fee:</span>
      <span>{toText(txInfo.fee)} CKB</span>
      <span className="leading-relaxed font-bold tracking-wider">Maturity:</span>
      <span>{maturity}</span>
    </span>
  );
}

async function transact(
  buildFreshTxInfo: () => Promise<TxInfo>,
  previewTxInfo: TxInfo,
  freezeTxInfo: (txInfo: TxInfo) => void,
  setMessage: (message: string) => void,
  setFailure: (message: string) => void,
  formReset: () => void,
  walletConfig: WalletConfig,
): Promise<void> {
  const { address, chain, queryClient } = walletConfig;

  try {
    freezeTxInfo(previewTxInfo);
    setFailure("");
    setMessage("Refreshing transaction...");
    const txInfo = await buildFreshTxInfo();
    if (txInfo.error !== "") {
      throw new Error(txInfo.error);
    }
    if (!hasTransactionActivity(txInfo.tx)) {
      throw new Error("Nothing to do right now");
    }
    if (txInfo.fee <= 0n) {
      throw new Error("Transaction fee is missing or invalid");
    }

    freezeTxInfo(txInfo);
    setMessage("Waiting for user confirmation...");
    await sendAndWaitForCommit({
      client: walletConfig.cccClient,
      signer: walletConfig.signer,
    }, txInfo.tx, {
      onConfirmationWait: () => {
        setMessage("Waiting for network confirmation...");
      },
    });

    setMessage("Transaction confirmed.");
    formReset();
    await new Promise((resolve) => setTimeout(resolve, 2000));
  } catch (error) {
    setFailure(errorMessageOf(error));
  } finally {
    freezeTxInfo(txInfoPadding);
    await queryClient.invalidateQueries({ queryKey: [chain, address] });
    setMessage("");
  }
}

function timeUntilMaturity(
  estimatedMaturity: bigint,
  tipTimestamp: bigint,
): {
  maturity: string;
  isReady: boolean;
} {
  const remaining = estimatedMaturity - tipTimestamp;
  if (remaining <= 0n) {
    return { maturity: "⌛️ Ready", isReady: true };
  }

  const minute = 60_000n;
  const hour = 60n * minute;
  const day = 24n * hour;

  if (remaining <= 90n * minute) {
    return {
      maturity: `⏳ ${String(Number((remaining + minute - 1n) / minute))} minutes`,
      isReady: false,
    };
  }

  if (remaining <= day) {
    return {
      maturity: `⏳ ${String(Number((remaining + hour - 1n) / hour))} hours`,
      isReady: false,
    };
  }

  return {
    maturity: `⏳ ${String(Number((remaining + day - 1n) / day))} days`,
    isReady: false,
  };
}
