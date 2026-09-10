import type { WalletConfig } from "../shared/utils.ts";
import { objectIdentityKey } from "./rootConfigQueryKey.ts";

/**
 * Builds the L1 account query key for one wallet config object.
 *
 * @remarks The wallet config is rebuilt whenever its signer, locks, or client change, so its
 * object identity is the cache boundary; a refetched config starts a cold L1 query
 * (decisions amendment 46(h)).
 */
export function l1StateQueryKey(
  walletConfig: Pick<WalletConfig, "chain" | "address"> & object,
): readonly [WalletConfig["chain"], string, number, "l1State"] {
  return [
    walletConfig.chain,
    walletConfig.address,
    objectIdentityKey(walletConfig),
    "l1State",
  ] as const;
}
