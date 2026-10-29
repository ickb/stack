import { ccc } from "@ckb-ccc/core";
import { tipMaxAgeMs, type LockUpPolicy } from "../../../src/dao.ts";
import {
  chainIdentities,
  type ChainIdentity,
  type SupportedChain,
} from "../../../src/utils/chain.ts";
import { clientCache } from "../../../src/utils/utils.ts";
import { verifiedClient } from "../../../src/utils/verified_client.ts";

/** Public chain preflight evidence returned after identity verification. */
export interface ChainPreflightEvidence {
  /** Chain requested by the runtime config. */
  chain: SupportedChain;

  /** Expected public chain identity. */
  expected: ChainIdentity;

  /** Observed RPC identity and current tip evidence. */
  observed: {
    /** Observed genesis block hash. */
    genesisHash: ccc.Hex;
    /** Address prefix reported by the CCC client. */
    addressPrefix: string;
    /** Tip header fields read during preflight. */
    tip: {
      hash: ccc.Hex;
      number: bigint;
      timestamp: bigint;
    };
  };

  /** Per-field identity comparison results. */
  matches: {
    genesisHash: boolean;
    addressPrefix: boolean;
  };
}

/**
 * Verifies that an RPC client matches the expected public chain identity; transport
 * failures propagate as thrown, and the JSON-line normalizer logs them whole.
 */
export async function verifyChainPreflight(
  client: ccc.Client,
  chain: SupportedChain,
): Promise<ChainPreflightEvidence> {
  return assertChainPreflight(await readChainPreflight(client, chain));
}

/**
 * Opens the public client for one chain, owned by the caller: a configured `rpcUrl` is the
 * only endpoint (an operator's own node), otherwise CCC's public pool for the chain,
 * WebSocket first with HTTPS fallbacks. Every header it hands out is verified, and the
 * tip may trail the clock by at most the policy's slack. The caller disposes the owner at
 * the end of the turn so the sockets close and the process can exit.
 */
export function createPublicClient(
  chain: SupportedChain,
  lockUp: LockUpPolicy,
  rpcUrl?: string,
): ccc.Owner<ccc.Client> {
  const config = {
    cache: clientCache(),
    ...(rpcUrl === undefined ? {} : { urls: [rpcUrl] as const }),
  };
  const owner = (
    chain === "mainnet" ? ccc.ClientPublicMainnet : ccc.ClientPublicTestnet
  ).open(config);
  return new ccc.OwnerUnique(verifiedClient(owner.value, tipMaxAgeMs(lockUp)), async () =>
    owner.dispose(),
  );
}

async function readChainPreflight(
  client: ccc.Client,
  chain: SupportedChain,
): Promise<ChainPreflightEvidence> {
  const expected = chainIdentities[chain];
  const [genesis, tip] = await Promise.all([
    client.getHeaderByNumber(0n),
    client.getTipHeader(),
  ]);

  if (genesis === undefined) {
    throw new Error(`Missing ${chain} genesis header`);
  }

  return {
    chain,
    expected,
    observed: {
      genesisHash: genesis.hash,
      addressPrefix: client.addressPrefix,
      tip: {
        hash: tip.hash,
        number: tip.number,
        timestamp: tip.timestamp,
      },
    },
    matches: {
      genesisHash: genesis.hash === expected.genesisHash,
      addressPrefix: client.addressPrefix === expected.addressPrefix,
    },
  };
}

function assertChainPreflight(evidence: ChainPreflightEvidence): ChainPreflightEvidence {
  const failures: string[] = [];
  if (!evidence.matches.genesisHash) {
    failures.push(
      `genesis hash expected ${evidence.expected.genesisHash} observed ${evidence.observed.genesisHash}`,
    );
  }
  if (!evidence.matches.addressPrefix) {
    failures.push(
      `address prefix expected ${evidence.expected.addressPrefix} observed ${evidence.observed.addressPrefix}`,
    );
  }
  if (failures.length > 0) {
    throw new Error(
      `Invalid ${evidence.chain} RPC chain identity: ${failures.join("; ")}`,
    );
  }

  return evidence;
}
