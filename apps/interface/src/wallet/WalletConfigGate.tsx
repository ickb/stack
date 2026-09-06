import { ccc } from "@ckb-ccc/ccc";
import { unique } from "@ickb/sdk";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type JSX } from "react";
import App from "../app/App.tsx";
import type { QuoteState } from "../query/queries.ts";
import { walletConfigQueryKey } from "../query/walletConfigQueryKey.ts";
import type { RootConfig } from "../shared/utils.ts";
import { WalletConfigPendingView } from "./WalletConfigPendingView.tsx";

/** Builds signer-bound wallet config before rendering the connected wallet app. */
export default function WalletConfigGate({
  rootConfig,
  signer,
  walletName,
  openWallet,
  rawText,
  setRawText,
  quoteState,
}: Readonly<{
  rootConfig: RootConfig;
  signer: ccc.Signer;
  walletName: string;
  openWallet: () => unknown;
  rawText: string;
  setRawText: (value: string) => void;
  quoteState?: QuoteState;
}>): JSX.Element {
  const [signerVersion, setSignerVersion] = useState(0);
  // Signer replacement is the freshness boundary for a stable signer object.
  useEffect(
    () =>
      signer.onReplaced(() => {
        setSignerVersion((version) => version + 1);
      }),
    [signer],
  );
  const {
    isPending,
    error,
    data: walletConfig,
    refetch,
  } = useQuery({
    queryKey: walletConfigQueryKey(rootConfig, signer, signerVersion),
    retry: false,
    queryFn: async () => {
      if (!(await signer.isConnected())) {
        await signer.connect();
      }

      const [recommendedAddressObj, addressObjs] = await Promise.all([
        signer.getRecommendedAddressObj(),
        signer.getAddressObjs(),
      ]);
      const recommendedLock = ccc.Script.from(recommendedAddressObj.script);

      const accountLocks = [
        ...unique([
          recommendedLock,
          ...addressObjs.map(({ script }) => ccc.Script.from(script)),
        ]),
      ];

      return {
        ...rootConfig,
        cccClient: signer.client,
        signer,
        address: recommendedAddressObj.toString(),
        accountLocks,
        primaryLock: recommendedLock,
      };
    },
  });

  if (isPending) {
    return (
      <WalletConfigPendingView
        {...{ rootConfig, walletName, openWallet, rawText, setRawText, quoteState }}
      />
    );
  }

  if (error !== null) {
    return (
      <WalletConfigPendingView
        {...{ rootConfig, walletName, openWallet, rawText, setRawText, quoteState }}
        error={error}
        retry={() => {
          void refetch();
        }}
      />
    );
  }

  return (
    <App
      {...{
        walletConfig,
        walletName,
        openWallet,
        rawText,
        setRawText,
        quoteState,
      }}
    />
  );
}
