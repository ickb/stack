import { ccc } from "@ckb-ccc/ccc";
import {
  clientCache,
  IckbSdk,
  tipMaxAgeMs,
  verifiedClient,
  WALLET_LOCK_UP,
} from "@ickb/sdk";
import { QueryClient } from "@tanstack/react-query";
import type { CSSProperties } from "react";
import type { RootConfig } from "../shared/utils.ts";

export const appName = "iCKB DApp";
export const connectorStyle: CSSProperties & Record<`--${string}`, string> = {
  "--background": "oklch(21% 0.006 286)",
  "--divider": "oklch(37.9% 0.025 69)",
  "--btn-primary": "oklch(15.5% 0.007 286)",
  "--btn-primary-hover": "oklch(24.5% 0.008 286)",
  "--btn-secondary": "oklch(49.5% 0.103 64)",
  "--btn-secondary-hover": "oklch(56% 0.13 64)",
  "--icon-primary": "oklch(95.8% 0.011 137)",
  "--icon-secondary": "oklch(78.3% 0.168 66)",
  "--tip-color": "oklch(81.3% 0.025 139)",
  color: "oklch(95.8% 0.011 137)",
  fontFamily: "inherit",
};
export const queryClient = new QueryClient();
// One verified client per chain on CCC's public pool (WebSocket first, HTTPS fallbacks),
// kept for the app's lifetime, so its owner is never disposed: the connector's network
// list borrows them, and a chain tab lends the chosen one through an Owner the Provider
// may dispose without effect. The tip may trail the clock by the wallet policy's slack.
const clients = {
  mainnet: verifiedClient(
    ccc.ClientPublicMainnet.open({ cache: clientCache() }).value,
    tipMaxAgeMs(WALLET_LOCK_UP),
  ),
  testnet: verifiedClient(
    ccc.ClientPublicTestnet.open({ cache: clientCache() }).value,
    tipMaxAgeMs(WALLET_LOCK_UP),
  ),
};
export const mainnetClient = clients.mainnet;
export const testnetClient = clients.testnet;
export function lendClient(chain: RootConfig["chain"]): ccc.Owner<ccc.Client> {
  return new ccc.OwnerUnique(clients[chain], () => {
    // Borrowed: the app keeps the client for its lifetime.
  });
}
export const savedConnectionRestoreMs = 800;

const sdks = {
  mainnet: IckbSdk.fromChain("mainnet"),
  testnet: IckbSdk.fromChain("testnet"),
};

export function createRootConfig(
  chain: RootConfig["chain"],
  cccClient: ccc.Client,
): RootConfig {
  return {
    chain,
    queryClient,
    cccClient,
    resetClient: (): void => {
      // The connector hands out a fee-rate proxy whose writes forward to the wrapped client.
      // eslint-disable-next-line no-param-reassign -- The cache is the client's own mutable slot; a new client would remount the app.
      cccClient.cache = clientCache();
    },
    sdk: sdks[chain],
  };
}

export async function ckbSignerOnly(signerInfo: ccc.SignerInfo): Promise<boolean> {
  await Promise.resolve();
  return isCkbSigner(signerInfo.signer);
}

export function isCkbSigner(signer: ccc.Signer): boolean {
  return signer.type === ccc.SignerType.CKB;
}
