import type { ccc } from "@ckb-ccc/ccc";
import { useEffect, useRef, useState, type JSX } from "react";
import { lendClient, savedConnectionRestoreMs } from "../app/interfaceConfig.ts";
import { liveQuoteStatus, type QuoteStateQuery } from "../query/quoteState.ts";
import type { RootConfig } from "../shared/utils.ts";
import { WalletAppShell } from "../view/staticWalletApp.tsx";
import { hasSavedCccConnection } from "./cccConnection.ts";

export function LandingPage({
  open,
  setClient,
  rootConfig,
  isCkb2Udt,
  setIsCkb2Udt,
  text,
  setText,
  quoteStateQuery,
}: Readonly<{
  open: () => unknown;
  setClient: (client: ccc.Owner<ccc.Client>) => unknown;
  rootConfig: RootConfig;
  isCkb2Udt: boolean;
  setIsCkb2Udt: (value: boolean) => void;
  text: string;
  setText: (value: string) => void;
  quoteStateQuery: QuoteStateQuery;
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

  const connect = (): void => {
    clearPendingOpen();
    if (!hasSavedCccConnection()) {
      setRestoringChain(undefined);
      open();
      return;
    }

    setRestoringChain(chain);
    pendingOpen.current = globalThis.setTimeout(() => {
      setRestoringChain(undefined);
      open();
    }, savedConnectionRestoreMs);
  };
  const selectChain = (nextChain: RootConfig["chain"]): void => {
    clearPendingOpen();
    setRestoringChain(undefined);
    setClient(lendClient(nextChain));
  };

  return (
    <WalletAppShell
      {...{ chain, isCkb2Udt, setIsCkb2Udt, text, setText, isRestoring, selectChain }}
      liveStatus={
        quoteStateQuery.data !== undefined ? "" : liveQuoteStatus(quoteStateQuery)
      }
      open={connect}
      quoteState={quoteStateQuery.data}
    />
  );
}

export function TestnetHint(): JSX.Element {
  return (
    <p className="text-sm leading-relaxed text-ickb-muted">
      Need testnet CKB?{" "}
      <a
        href="https://faucet.nervos.org/"
        target="_blank"
        rel="noopener noreferrer"
        className="text-ickb-action hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ickb-action"
      >
        Faucet
      </a>{" "}
      before starting a conversion.
    </p>
  );
}
