import { ccc } from "@ckb-ccc/ccc";
import { signerAccountLocks } from "@ickb/sdk";

import { useEffect, useState, type JSX } from "react";
import App from "../app/App.tsx";
import type { QuoteState } from "../app/queries.ts";
import type { RootConfig, WalletConfig } from "../shared/utils.ts";
import { WalletConfigPendingView } from "./WalletConfigPendingView.tsx";

/** One read of the signer's address and locks, tagged with what it was read for. */
type WalletConfigRead = Readonly<
  { rootConfig: RootConfig; signer: ccc.Signer; attempt: number } & (
    { config: WalletConfig } | { error: unknown }
  )
>;

/**
 * Reads the signer-bound wallet config once per signer, then renders the connected app.
 *
 * @remarks The connector hands out a new signer when the wallet switches account, and
 * nothing else changes the address, so the signer is the only freshness boundary; a
 * background refetch would only remount the app under the user (decisions amendment 52).
 */
export default function WalletConfigGate({
  rootConfig,
  signer,
  walletName,
  openWallet,
  isCkb2Udt,
  setIsCkb2Udt,
  text,
  setText,
  quoteState,
}: Readonly<{
  rootConfig: RootConfig;
  signer: ccc.Signer;
  walletName: string;
  openWallet: () => unknown;
  isCkb2Udt: boolean;
  setIsCkb2Udt: (value: boolean) => void;
  text: string;
  setText: (value: string) => void;
  quoteState?: QuoteState;
}>): JSX.Element {
  const draft = { isCkb2Udt, setIsCkb2Udt, text, setText };
  const [attempt, setAttempt] = useState(0);
  const [read, setRead] = useState<WalletConfigRead>();
  useEffect(() => {
    const cancelled = new AbortController();
    const readOnce = async (): Promise<WalletConfigRead> => {
      try {
        return {
          rootConfig,
          signer,
          attempt,
          config: await readWalletConfig(rootConfig, signer),
        };
      } catch (error: unknown) {
        return { rootConfig, signer, attempt, error };
      }
    };
    void (async (): Promise<void> => {
      const result = await readOnce();
      if (!cancelled.signal.aborted) {
        setRead(result);
      }
    })();
    return (): void => {
      cancelled.abort();
    };
  }, [rootConfig, signer, attempt]);

  if (
    read?.rootConfig !== rootConfig ||
    read.signer !== signer ||
    read.attempt !== attempt
  ) {
    return (
      <WalletConfigPendingView
        {...{ rootConfig, walletName, openWallet, ...draft, quoteState }}
      />
    );
  }
  if ("error" in read) {
    return (
      <WalletConfigPendingView
        {...{ rootConfig, walletName, openWallet, ...draft, quoteState }}
        error={read.error}
        retry={() => {
          setAttempt((count) => count + 1);
        }}
      />
    );
  }
  return (
    <App
      {...{ walletName, openWallet, ...draft, quoteState }}
      walletConfig={read.config}
    />
  );
}

async function readWalletConfig(
  rootConfig: RootConfig,
  signer: ccc.Signer,
): Promise<WalletConfig> {
  if (!(await signer.isConnected())) {
    await signer.connect();
  }
  const recommendedAddressObj = await signer.getRecommendedAddressObj();
  const primaryLock = ccc.Script.from(recommendedAddressObj.script);
  return {
    ...rootConfig,
    cccClient: signer.client,
    signer,
    address: recommendedAddressObj.toString(),
    accountLocks: await signerAccountLocks(signer, primaryLock),
    primaryLock,
  };
}
