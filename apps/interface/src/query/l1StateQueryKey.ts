import type { WalletConfig } from "../shared/utils.ts";
import { walletLocksKey } from "./queryStateId.ts";

/** Builds the exact L1 account query key for a wallet and its current lock set. */
export function l1StateQueryKey(
  walletConfig: Pick<WalletConfig, "chain" | "address" | "accountLocks" | "primaryLock">,
): readonly [WalletConfig["chain"], string, string, "l1State"] {
  return [
    walletConfig.chain,
    walletConfig.address,
    walletLocksKey(walletConfig),
    "l1State",
  ] as const;
}
