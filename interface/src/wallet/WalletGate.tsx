import { useCcc, useSigner } from "@ckb-ccc/connector-react";
import { useEffect, useMemo, useState, type JSX } from "react";
import { createRootConfig } from "../app/interfaceConfig.ts";
import { useQuoteState } from "../app/queries.ts";
import { buttonClass, chainFromClient, walletLabel } from "../shared/utils.ts";
import { LandingPage, TestnetHint } from "./LandingPage.tsx";
import WalletConfigGate from "./WalletConfigGate.tsx";

/**
 * The connector's client is the one source of the chain: the wallet modal's network list
 * sets it, so a switch that leaves no signer on the new chain (a wallet connected on one
 * network only) still shows the landing page on that chain.
 */
export function WalletGate(): JSX.Element {
  const { client, close, open, wallet, signerInfo } = useCcc();
  const signer = useSigner();
  const chain = chainFromClient(client);
  const [isCkb2Udt, setIsCkb2Udt] = useState(true);
  const [text, setText] = useState("");
  const draft = { isCkb2Udt, setIsCkb2Udt, text, setText };
  const rootConfig = useMemo(() => createRootConfig(chain, client), [client, chain]);
  const quoteStateQuery = useQuoteState(rootConfig);
  // A network or fee-rate pick in the wallet modal replaces the client; the connector would
  // leave its list open afterwards, so the pick closes the modal.
  useEffect(() => {
    close();
  }, [client, close]);

  if (signer === undefined) {
    return (
      <>
        <LandingPage {...{ open, rootConfig, ...draft, quoteStateQuery }} />
        {chain === "testnet" ? <TestnetHint /> : null}
      </>
    );
  }

  if (chainFromClient(signer.client) !== chain) {
    return <SwitchingWalletNetwork open={open} />;
  }

  const walletName = walletLabel(wallet?.name, signerInfo?.name);
  return (
    <WalletConfigGate
      {...{ rootConfig, signer, walletName, ...draft }}
      openWallet={open}
      quoteState={quoteStateQuery.data}
    />
  );
}

export function SwitchingWalletNetwork({
  open,
}: Readonly<{ open: () => unknown }>): JSX.Element {
  return (
    <div className="flex flex-col space-y-4">
      <p>Switching wallet network...</p>
      <button
        className={buttonClass}
        onClick={() => {
          open();
        }}
      >
        Open wallet connector
      </button>
    </div>
  );
}
