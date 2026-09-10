import { ccc } from "@ckb-ccc/ccc";
import { getConfig, IckbSdk } from "@ickb/sdk";
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
export function createClient(chain: RootConfig["chain"]): ccc.Client {
  return chain === "mainnet"
    ? new ccc.ClientPublicMainnet({ url: "https://mainnet.ckb.dev/", fallbacks: [] })
    : new ccc.ClientPublicTestnet({ url: "https://testnet.ckb.dev/", fallbacks: [] });
}
export const mainnetClient = createClient("mainnet");
export const testnetClient = createClient("testnet");
export const savedConnectionRestoreMs = 800;

const sdks = {
  mainnet: IckbSdk.fromConfig(getConfig("mainnet")),
  testnet: IckbSdk.fromConfig(getConfig("testnet")),
};

export function createRootConfig(
  chain: RootConfig["chain"],
  cccClient: ccc.Client,
  // The connector's setter returns unknown; the reset discards it.
  setClient: (client: ccc.Client) => unknown,
): RootConfig {
  return {
    chain,
    queryClient,
    cccClient,
    resetClient: (): void => {
      setClient(createClient(chain));
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
