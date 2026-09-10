import type { RootConfig } from "../shared/utils.ts";

interface RootConfigQueryKeyInput {
  chain: RootConfig["chain"];
  cccClient: object;
}

let nextObjectKey = 1;
const objectKeys = new WeakMap<object, number>();

/**
 * Builds the chain-level query key for root configuration reads.
 *
 * @remarks The client segment is based on object identity, so recreating an equivalent client creates a distinct cache key.
 */
export function rootConfigQueryKey(
  rootConfig: RootConfigQueryKeyInput,
): readonly [RootConfig["chain"], number, "rootConfig"] {
  return [
    rootConfig.chain,
    objectIdentityKey(rootConfig.cccClient),
    "rootConfig",
  ] as const;
}

/**
 * Assigns a stable process-local cache key to one object instance.
 *
 * @remarks Keys are identity-based and WeakMap-backed; structurally equal objects never share a key unless they are the same object.
 */
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
