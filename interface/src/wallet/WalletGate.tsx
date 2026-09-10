import { useCcc, useSigner } from "@ckb-ccc/connector-react";
import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import {
  createRootConfig,
  isCkbSigner,
  mainnetClient,
  testnetClient,
} from "../app/interfaceConfig.ts";
import { useQuoteState } from "../query/quoteState.ts";
import { savedSelectedChain, saveSelectedChain } from "./cccConnection.ts";
import { chainFromClient } from "./chain.ts";
import { LandingPage, TestnetHint } from "./interfaceLanding.tsx";
import WalletConfigGate from "./WalletConfigGate.tsx";
import {
  activeChain,
  activeConnectedChain,
  selectedClient,
  signerClientChain,
  walletLabel,
} from "./walletGateState.ts";
import {
  CkbSignerRequired,
  SwitchingWalletNetwork,
  UnsupportedNetwork,
} from "./walletGateSupport.tsx";

export function WalletGate(): JSX.Element {
  const { client, close, open, setClient, wallet, signerInfo } = useCcc();
  const signer = useSigner();
  const [draftChain, setDraftChain] = useState<
    NonNullable<ReturnType<typeof savedSelectedChain>>
  >(() => savedSelectedChain() ?? "mainnet");
  const previousConnectedChain = useRef<ReturnType<typeof savedSelectedChain>>(undefined);
  const clientChain = chainFromClient(client);
  const chain = activeChain(signer, clientChain, draftChain);
  const [rawText, setRawText] = useState("C");
  const draftClient = draftChain === "mainnet" ? mainnetClient : testnetClient;
  const activeClient = selectedClient(signer, client, draftClient);
  const rootConfig = useMemo(
    () =>
      chain === undefined ? undefined : createRootConfig(chain, activeClient, setClient),
    [activeClient, chain, setClient],
  );
  const testnetHint = chain === "testnet" ? <TestnetHint /> : null;
  const quoteStateQuery = useQuoteState(rootConfig);

  useEffect(() => {
    if (
      signer !== undefined &&
      clientChain !== undefined &&
      previousConnectedChain.current !== undefined &&
      previousConnectedChain.current !== clientChain
    ) {
      close();
    }

    previousConnectedChain.current = activeConnectedChain(signer, clientChain);
  }, [clientChain, close, signer]);

  useEffect(() => {
    if (chain !== undefined) {
      saveSelectedChain(chain);
    }
  }, [chain]);

  if (signer === undefined) {
    return (
      <>
        <LandingPage
          {...{
            open,
            setClient,
            rootConfig: createRootConfig(draftChain, draftClient, setClient),
            rawText,
            setRawText,
            quoteStateQuery,
            setDraftChain,
          }}
        />
        {testnetHint}
      </>
    );
  }

  if (!isCkbSigner(signer)) {
    return <CkbSignerRequired open={open} />;
  }

  if (rootConfig === undefined) {
    return <UnsupportedNetwork addressPrefix={client.addressPrefix} open={open} />;
  }

  const signerChain = signerClientChain(signer);

  if (signerChain !== chain) {
    return <SwitchingWalletNetwork open={open} />;
  }

  const walletName = walletLabel(wallet?.name, signerInfo?.name);
  return (
    <WalletConfigGate
      {...{ rootConfig, signer, walletName, rawText, setRawText }}
      openWallet={open}
      quoteState={quoteStateQuery.data}
    />
  );
}
