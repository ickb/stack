import { ccc } from "@ckb-ccc/core";
import { CHAINS, type SupportedChain } from "../../../src/constants.ts";
import { CACHE_SIZES } from "../../../src/utils/utils.ts";

/**
 * Refuses an RPC client whose genesis is not `chain`'s: the one identity check a public
 * client needs, since its class already fixes the address prefix. Transport failures
 * propagate as thrown, and the JSON-line normalizer logs them whole.
 */
export async function verifyChainPreflight(
  client: ccc.Client,
  chain: SupportedChain,
): Promise<void> {
  const genesis = await client.getHeaderByNumber(0n);
  if (genesis === undefined) {
    throw new Error(`Missing ${chain} genesis header`);
  }
  const expected = CHAINS[chain].genesisHash;
  if (genesis.hash !== expected) {
    throw new Error(
      `Invalid ${chain} RPC chain identity: genesis hash expected ${expected} observed ${genesis.hash}`,
    );
  }
}

/**
 * Opens the public client for one chain, owned by the caller: the configured `rpcUrls` are
 * the only endpoints, tried in the order given. The SDK verifies what it reads through it. The
 * caller disposes the owner when it is done, so the sockets close and the process can exit.
 */
export function createPublicClient(
  chain: SupportedChain,
  rpcUrls: readonly [string, ...string[]],
): ccc.Owner<ccc.Client> {
  return (chain === "mainnet" ? ccc.ClientPublicMainnet : ccc.ClientPublicTestnet).open({
    cache: new ccc.ClientCacheMemory(...CACHE_SIZES),
    urls: rpcUrls,
  });
}
