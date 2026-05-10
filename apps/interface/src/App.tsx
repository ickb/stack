import { useDeferredValue, useState, type JSX } from "react";
import { useQuery } from "@tanstack/react-query";
import Action from "./Action.tsx";
import { Dashboard } from "./Dashboard.tsx";
import Form from "./Form.tsx";
import Progress from "./Progress.tsx";
import {
  l1StateOptions,
  type L1StateType,
} from "./queries.ts";
import {
  direction2Symbol,
  errorMessageOf,
  symbol2Direction,
  toBigInt,
  type WalletConfig,
} from "./utils.ts";

export default function App({
  walletConfig,
}: {
  walletConfig: WalletConfig;
}): JSX.Element {
  const [isFrozen, freeze] = useState(false);
  const [rawText, setRawText] = useState(direction2Symbol(true));
  const l1StateQuery = useQuery<L1StateType>({
    ...l1StateOptions(walletConfig, isFrozen),
  });
  const symbol = rawText.startsWith("I") ? "I" : "C";
  const isCkb2Udt = symbol2Direction(symbol);
  const amount = toBigInt(rawText.slice(1));
  const formReset = (): void => {
    setRawText(direction2Symbol(isCkb2Udt));
  };
  const deferredActionParams = useDeferredValue<{
    isCkb2Udt: boolean;
    amount: bigint;
    freeze: (value: boolean) => void;
    formReset: () => void;
    walletConfig: WalletConfig;
    l1State: L1StateType | undefined;
    isStateFetching: boolean;
  }>({
    isCkb2Udt,
    amount,
    freeze,
    formReset,
    walletConfig,
    l1State: l1StateQuery.data,
    isStateFetching: l1StateQuery.isFetching,
  });

  if (l1StateQuery.data === undefined) {
    if (l1StateQuery.isError) {
      return (
        <>
          <Dashboard {...{ walletConfig }} />
          <Progress isDone={true}>
            <span className="flex flex-col gap-4 text-center">
              <span>Unable to load live iCKB state: {errorMessageOf(l1StateQuery.error)}</span>
              <button
                className="cursor-pointer rounded border-2 border-amber-400 px-4 py-2 font-bold tracking-wider text-amber-400 uppercase"
                onClick={() => {
                  void l1StateQuery.refetch();
                }}
              >
                Retry
              </button>
            </span>
          </Progress>
        </>
      );
    }

    return (
      <>
        <Dashboard {...{ walletConfig }} />
        <Progress>Loading live iCKB state...</Progress>
      </>
    );
  }

  const l1State = l1StateQuery.data;

  return (
    <>
      <Dashboard {...{ walletConfig }} />
      <Form
        {...{
          rawText,
          setRawText,
          amount,
          system: l1State.system,
          isFrozen,
          ckbNative: l1State.ckbNative,
          ickbNative: l1State.ickbNative,
          ckbAvailable: l1State.ckbAvailable,
          ickbAvailable: l1State.ickbAvailable,
          ckbBalance: l1State.ckbBalance,
          ickbBalance: l1State.ickbBalance,
        }}
      />
      <Action {...deferredActionParams} />
    </>
  );
}
