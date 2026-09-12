import { ccc } from "@ckb-ccc/ccc";
import { useRef, useState, type JSX, type SyntheticEvent } from "react";
import { createRootConfig, testnetClient } from "../../src/app/interfaceConfig.ts";
import { useQuoteState } from "../../src/query/quoteState.ts";
import type { RootConfig } from "../../src/shared/utils.ts";
import WalletConfigGate from "../../src/wallet/WalletConfigGate.tsx";

export function WalletGate(): JSX.Element {
  const [rootConfig] = useState<RootConfig>(() =>
    createRootConfig("testnet", testnetClient),
  );
  const [signer, setSigner] = useState<ccc.Signer>();
  const [rawText, setRawText] = useState("C");
  const quoteState = useQuoteState(rootConfig).data;

  if (signer === undefined) {
    return <PrivateKeyGate rootConfig={rootConfig} connect={setSigner} />;
  }

  return (
    <WalletConfigGate
      {...{ rootConfig, signer, rawText, setRawText, quoteState }}
      walletName="Private Key Test Wallet"
      openWallet={() => {
        setSigner(undefined);
      }}
    />
  );
}

function PrivateKeyGate({
  rootConfig,
  connect,
}: Readonly<{
  rootConfig: RootConfig;
  connect: (signer: ccc.Signer) => void;
}>): JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const submit = (event: SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const element = input.current;
    if (element === null) {
      return;
    }

    const privateKey = element.value;
    element.value = "";
    try {
      connect(new ccc.SignerCkbPrivateKey(rootConfig.cccClient, privateKey));
    } catch {
      setError("Invalid testnet private key");
    }
  };

  return (
    <form
      onSubmit={submit}
      className="grid h-full content-center gap-5 border-t border-ickb-border py-8 text-center"
    >
      <label className="grid gap-3 text-lg font-medium text-ickb-text">
        Disposable testnet private key
        <input
          ref={input}
          type="password"
          autoComplete="off"
          spellCheck={false}
          required={true}
          aria-label="Disposable testnet private key"
          className="bg-ickb-base w-full rounded border border-ickb-border px-3 py-2 font-mono text-base text-ickb-text outline-none focus:border-ickb-action"
        />
      </label>
      <p className="text-sm text-ickb-muted">
        Testnet only. The key is kept in browser memory for signing and is never saved.
      </p>
      {error === "" ? null : <p className="text-ickb-danger text-sm">{error}</p>}
      <button
        type="submit"
        className="cursor-pointer rounded border border-ickb-action px-4 py-2 font-bold tracking-wider text-ickb-action uppercase hover:bg-ickb-action/10"
      >
        Connect test wallet
      </button>
    </form>
  );
}
