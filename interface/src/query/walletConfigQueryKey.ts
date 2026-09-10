import type { RootConfig } from "../shared/utils.ts";
import { objectIdentityKey, rootConfigQueryKey } from "./rootConfigQueryKey.ts";

interface WalletConfigQueryKeyInput {
  chain: RootConfig["chain"];
  cccClient: object;
  queryClient: object;
  sdk: object;
}

/**
 * Builds the wallet query key for signer-bound configuration reads.
 *
 * @remarks The key starts with chain plus CCC client identity from
 * `rootConfigQueryKey`; query client, SDK, and signer use object identity,
 * while signerVersion is the freshness boundary for the same signer object.
 */
export function walletConfigQueryKey(
  rootConfig: WalletConfigQueryKeyInput,
  signer: object,
  signerVersion: number,
): readonly [
  RootConfig["chain"],
  number,
  "rootConfig",
  number,
  number,
  number,
  number,
  "walletConfig",
] {
  return [
    ...rootConfigQueryKey(rootConfig),
    objectIdentityKey(rootConfig.queryClient),
    objectIdentityKey(rootConfig.sdk),
    objectIdentityKey(signer),
    signerVersion,
    "walletConfig",
  ] as const;
}
