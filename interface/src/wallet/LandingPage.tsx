import { useEffect, useRef, useState, type JSX } from "react";
import { ActionLayout } from "../action/ActionLayout.tsx";
import { savedConnectionRestoreMs } from "../app/interfaceConfig.ts";
import { liveQuoteStatus, type QuoteStateQuery } from "../app/queries.ts";
import type { RootConfig } from "../shared/utils.ts";
import { DisconnectedDashboard } from "../view/Dashboard.tsx";
import { QuotePage } from "../view/QuotePage.tsx";
import { hasSavedCccConnection } from "./cccConnection.ts";

export function LandingPage({
  open,
  rootConfig,
  isCkb2Udt,
  setIsCkb2Udt,
  text,
  setText,
  quoteStateQuery,
}: Readonly<{
  open: () => unknown;
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
  const [isRestoring, setIsRestoring] = useState(false);
  const chain = rootConfig.chain;
  // Clearing no timer is a no-op, so neither clear checks for one.
  const clearPendingOpen = (): void => {
    globalThis.clearTimeout(pendingOpen.current);
    pendingOpen.current = undefined;
  };

  useEffect(
    (): (() => void) => () => {
      globalThis.clearTimeout(pendingOpen.current);
    },
    // Once, on unmount: a list that never changes, whatever it holds.
    // Stryker disable next-line ArrayDeclaration: see above.
    [],
  );

  const connect = (): void => {
    clearPendingOpen();
    if (!hasSavedCccConnection()) {
      setIsRestoring(false);
      open();
      return;
    }

    setIsRestoring(true);
    pendingOpen.current = globalThis.setTimeout(() => {
      setIsRestoring(false);
      open();
    }, savedConnectionRestoreMs);
  };

  const liveStatus =
    quoteStateQuery.data !== undefined ? "" : `${liveQuoteStatus(quoteStateQuery)} `;
  return (
    <QuotePage
      {...{ chain, isCkb2Udt, setIsCkb2Udt, text, setText }}
      quoteState={quoteStateQuery.data}
      header={<DisconnectedDashboard chain={chain} />}
      action={
        <ActionLayout
          action={isRestoring ? "Restoring wallet" : "Connect wallet"}
          disabled={isRestoring}
          isDone={!isRestoring}
          onAction={connect}
          message={`${liveStatus}This is an estimate. Wallet balance, fee, and exact availability are checked after you connect.`}
          fee="..."
          maturity="..."
        />
      }
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
