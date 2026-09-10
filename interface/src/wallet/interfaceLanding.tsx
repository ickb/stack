import type { ccc } from "@ckb-ccc/ccc";
import { useEffect, useRef, useState, type JSX } from "react";
import {
  mainnetClient,
  savedConnectionRestoreMs,
  testnetClient,
} from "../app/interfaceConfig.ts";
import { liveQuoteStatus, type QuoteStateQuery } from "../query/quoteState.ts";
import type { RootConfig } from "../shared/utils.ts";
import { WalletAppShell } from "../view/staticWalletApp.tsx";
import { hasSavedCccConnection, saveSelectedChain } from "./cccConnection.ts";

export function LandingPage({
  open,
  setClient,
  rootConfig,
  rawText,
  setRawText,
  quoteStateQuery,
  setDraftChain,
}: Readonly<{
  open: () => unknown;
  setClient: (client: ccc.Client) => unknown;
  rootConfig: RootConfig;
  rawText: string;
  setRawText: (value: string) => void;
  quoteStateQuery: QuoteStateQuery;
  setDraftChain: (chain: RootConfig["chain"]) => void;
}>): JSX.Element {
  const pendingOpen = useRef<ReturnType<typeof globalThis.setTimeout> | undefined>(
    undefined,
  );
  const [restoringChain, setRestoringChain] = useState<RootConfig["chain"] | undefined>();
  const chain = rootConfig.chain;
  const isRestoring = restoringChain === chain;
  const clearPendingOpen = (): void => {
    if (pendingOpen.current === undefined) {
      return;
    }

    globalThis.clearTimeout(pendingOpen.current);
    pendingOpen.current = undefined;
  };

  useEffect(
    (): (() => void) => () => {
      if (pendingOpen.current !== undefined) {
        globalThis.clearTimeout(pendingOpen.current);
      }
    },
    [],
  );

  const connect = (selectedChain: RootConfig["chain"], client: ccc.Client): void => {
    clearPendingOpen();
    saveSelectedChain(selectedChain);
    setClient(client);
    if (!hasSavedCccConnection()) {
      setRestoringChain(undefined);
      open();
      return;
    }

    setRestoringChain(selectedChain);
    pendingOpen.current = globalThis.setTimeout(() => {
      setRestoringChain(undefined);
      open();
    }, savedConnectionRestoreMs);
  };
  const selectChain = (nextChain: RootConfig["chain"]): void => {
    clearPendingOpen();
    setRestoringChain(undefined);
    saveSelectedChain(nextChain);
    setDraftChain(nextChain);
  };

  return (
    <WalletAppShell
      {...{ chain, rawText, setRawText, isRestoring, selectChain }}
      liveStatus={
        quoteStateQuery.data !== undefined ? "" : liveQuoteStatus(quoteStateQuery)
      }
      open={() => {
        connect(chain, chain === "mainnet" ? mainnetClient : testnetClient);
      }}
      quoteState={quoteStateQuery.data}
    />
  );
}

export function TestnetHint(): JSX.Element {
  return (
    <p className="text-sm leading-relaxed text-ickb-muted">
      Need testnet CKB?{" "}
      <a
        href="https://testnet.explorer.nervos.org/faucet"
        className="text-ickb-action hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ickb-action"
      >
        Faucet
      </a>{" "}
      before starting a conversion.
    </p>
  );
}
