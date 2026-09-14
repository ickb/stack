import type { ccc } from "@ckb-ccc/ccc";
import type { RootConfig } from "../shared/utils.ts";
import { chainFromClient } from "./chain.ts";

export function signerClientChain(signer: ccc.Signer): RootConfig["chain"] | undefined {
  return chainFromClient(signer.client);
}

export function walletLabel(
  walletName: string | undefined,
  signerName: string | undefined,
): string {
  const name = [walletName, signerName].filter(Boolean).join(" ");
  if (name !== "") {
    return name;
  }

  return "Wallet";
}
