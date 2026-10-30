import { ccc } from "@ckb-ccc/core";
import type { SupportedChain } from "../../../src/utils/chain.ts";
import { clientCache } from "../../../src/utils/utils.ts";

/** Each chain's genesis block hash, as CKB's mainnet.toml and testnet.toml specs give it. */
const GENESIS_HASHES = {
  mainnet: "0x92b197aa1fba0f63633922c61c92375c9c074a93e85963554f5499fe1450d0e5",
  testnet: "0x10639e0895502b5688a6be8cf69460d76541bfa4821629d86d62ba0aae3f9606",
} as const satisfies Record<SupportedChain, ccc.Hex>;

/** What the preflight saw, journaled once per process. */
export interface ChainPreflightEvidence {
  genesisHash: ccc.Hex;
}

/**
 * Refuses an RPC client whose genesis is not `chain`'s: the one identity check a public
 * client needs, since its class already fixes the address prefix. Transport failures
 * propagate as thrown, and the JSON-line normalizer logs them whole.
 */
export async function verifyChainPreflight(
  client: ccc.Client,
  chain: SupportedChain,
): Promise<ChainPreflightEvidence> {
  const genesis = await client.getHeaderByNumber(0n);
  if (genesis === undefined) {
    throw new Error(`Missing ${chain} genesis header`);
  }
  const expected = GENESIS_HASHES[chain];
  if (genesis.hash !== expected) {
    throw new Error(
      `Invalid ${chain} RPC chain identity: genesis hash expected ${expected} observed ${genesis.hash}`,
    );
  }
  return { genesisHash: genesis.hash };
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
    cache: clientCache(),
    urls: rpcUrls,
  });
}
