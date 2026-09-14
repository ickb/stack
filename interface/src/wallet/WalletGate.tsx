import { useCcc, useSigner } from "@ckb-ccc/connector-react";
import { useEffect, useMemo, useState, type JSX } from "react";
import { createRootConfig, isCkbSigner } from "../app/interfaceConfig.ts";
import { useQuoteState } from "../query/quoteState.ts";
import { saveSelectedChain } from "./cccConnection.ts";
import { chainFromClient } from "./chain.ts";
import { LandingPage, TestnetHint } from "./interfaceLanding.tsx";
import WalletConfigGate from "./WalletConfigGate.tsx";
import { signerClientChain, walletLabel } from "./walletGateState.ts";
import {
  CkbSignerRequired,
  SwitchingWalletNetwork,
  UnsupportedNetwork,
} from "./walletGateSupport.tsx";

/**
 * The connector's client is the one source of the chain: the landing tabs and the wallet
 * modal's network switch both set it, so a switch that leaves no signer on the new chain
 * (a wallet connected on one network only) still shows the landing page on that chain.
 */
export function WalletGate(): JSX.Element {
  const { client, open, setClient, wallet, signerInfo } = useCcc();
  const signer = useSigner();
  const chain = chainFromClient(client);
  const [rawText, setRawText] = useState("C");
  const rootConfig = useMemo(
    () => (chain === undefined ? undefined : createRootConfig(chain, client)),
    [client, chain],
  );
  const quoteStateQuery = useQuoteState(rootConfig);

  useEffect(() => {
    if (chain !== undefined) {
      saveSelectedChain(chain);
    }
  }, [chain]);

  if (rootConfig === undefined) {
    return <UnsupportedNetwork addressPrefix={client.addressPrefix} open={open} />;
  }

  if (signer === undefined) {
    return (
      <>
        <LandingPage
          {...{ open, setClient, rootConfig, rawText, setRawText, quoteStateQuery }}
        />
        {chain === "testnet" ? <TestnetHint /> : null}
      </>
    );
  }

  if (!isCkbSigner(signer)) {
    return <CkbSignerRequired open={open} />;
  }

  if (signerClientChain(signer) !== chain) {
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
