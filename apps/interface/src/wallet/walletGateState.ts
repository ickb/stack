import type { ccc } from "@ckb-ccc/ccc";
import type { RootConfig } from "../shared/utils.ts";
import { chainFromClient } from "./chain.ts";

export function activeChain(
  signer: ccc.Signer | undefined,
  clientChain: RootConfig["chain"] | undefined,
  draftChain: RootConfig["chain"],
): RootConfig["chain"] | undefined {
  if (signer !== undefined) {
    return clientChain;
  }

  return draftChain;
}

export function signerClientChain(signer: ccc.Signer): RootConfig["chain"] | undefined {
  return chainFromClient(signer.client);
}

export function selectedClient(
  signer: ccc.Signer | undefined,
  client: ccc.Client,
  draftClient: ccc.Client,
): ccc.Client {
  if (signer !== undefined) {
    return client;
  }

  return draftClient;
}

export function activeConnectedChain(
  signer: ccc.Signer | undefined,
  clientChain: RootConfig["chain"] | undefined,
): RootConfig["chain"] | undefined {
  if (signer !== undefined) {
    return clientChain;
  }
  return undefined;
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
