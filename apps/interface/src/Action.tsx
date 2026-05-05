import { useQuery } from "@tanstack/react-query";
import { useState, type JSX } from "react";
import type { L1StateType } from "./queries.ts";
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
  isStateStale,
}: {
  isCkb2Udt: boolean;
  amount: bigint;
  freeze: (value: boolean) => void;
  formReset: () => void;
  walletConfig: WalletConfig;
  l1State: L1StateType | undefined;
  isStateFetching: boolean;
  isStateStale: boolean;
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
            if (isStateStale) {
              void walletConfig.queryClient.invalidateQueries({
                queryKey: [walletConfig.chain, walletConfig.address, "l1State"],
              });
              return;
            }

            void transact(
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
                  : isStateStale
                    ? `refresh before ${amount > 0n ? `converting to ${isCkb2Udt ? "iCKB" : "CKB"}` : "collecting converted funds"}`
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
  txInfo: TxInfo,
  freezeTxInfo: (txInfo: TxInfo) => void,
  setMessage: (message: string) => void,
  setFailure: (message: string) => void,
  formReset: () => void,
  walletConfig: WalletConfig,
): Promise<void> {
  const { address, chain, cccClient, queryClient, signer } = walletConfig;
  const maxConfirmationChecks = 60;

  try {
    freezeTxInfo(txInfo);
    setFailure("");
    setMessage("Waiting for user confirmation...");
    const txHash = await signer.sendTransaction(txInfo.tx);

    let status: string | undefined = "sent";
    let checks = 0;
    while (
      checks < maxConfirmationChecks &&
      (status === undefined || ["sent", "pending", "proposed"].includes(status))
    ) {
      setMessage("Waiting for network confirmation...");
      await new Promise((resolve) => setTimeout(resolve, 10000));
      status = (await cccClient.getTransaction(txHash))?.status;
      checks += 1;
    }

    if (checks >= maxConfirmationChecks) {
      throw new Error("Transaction confirmation timed out");
    }

    if (status !== "committed") {
      throw new Error(`Transaction ended with status: ${status ?? "unknown"}`);
    }

    setMessage("Transaction confirmed.");
    formReset();
    await queryClient.invalidateQueries({ queryKey: [chain, address] });
    await new Promise((resolve) => setTimeout(resolve, 2000));
  } catch (error) {
    setFailure(errorMessageOf(error));
  } finally {
    await queryClient.invalidateQueries({ queryKey: [chain, address] });
    freezeTxInfo(txInfoPadding);
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
