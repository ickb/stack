import type { RootConfig } from "./utils.ts";

export function connectorWalletConfigQueryKey(
  rootConfig: RootConfig,
  walletName: string,
  signerKey: number,
  signerVersion: number,
): readonly [RootConfig["chain"], number, number, number, string, number, number, "walletConfig"] {
  return [
    rootConfig.chain,
    objectIdentityKey(rootConfig.cccClient),
    objectIdentityKey(rootConfig.queryClient),
    objectIdentityKey(rootConfig.sdk),
    walletName,
    signerKey,
    signerVersion,
    "walletConfig",
  ] as const;
}

let nextObjectKey = 1;
const objectKeys = new WeakMap<object, number>();

export function objectIdentityKey(value: object): number {
  const existing = objectKeys.get(value);
  if (existing !== undefined) {
    return existing;
  }

  const key = nextObjectKey;
  nextObjectKey += 1;
  objectKeys.set(value, key);
  return key;
}
