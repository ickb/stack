import { ccc } from "@ckb-ccc/core";
import {
  chainIdentities,
  type ChainIdentity,
  type SupportedChain,
} from "../../../src/utils/index.ts";

export type { SupportedChain } from "../../../src/utils/chain.ts";

/** Credential-free identity of the RPC endpoint: one configured node, or CCC's public pool. */
export type PublicRpcEndpointIdentity =
  | {
      mode: "exclusive";
      protocol: "http:" | "https:" | "ws:" | "wss:";
      hostname: string;
      port: string;
      pathname: string;
    }
  | { mode: "default" };

/** Reduces a configured RPC URL to the public fields needed for runtime identity. */
export function publicRpcEndpointIdentity(
  rpcUrl: string | undefined,
): PublicRpcEndpointIdentity {
  if (rpcUrl === undefined) {
    return { mode: "default" };
  }
  let url: URL;
  try {
    url = new URL(rpcUrl);
  } catch {
    throw invalidRpcEndpointIdentity();
  }
  if (!isRpcProtocol(url.protocol) || url.username !== "" || url.password !== "") {
    throw invalidRpcEndpointIdentity();
  }
  return {
    mode: "exclusive",
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port,
    pathname: url.pathname,
  };
}

function isRpcProtocol(
  protocol: string,
): protocol is "http:" | "https:" | "ws:" | "wss:" {
  return ["http:", "https:", "ws:", "wss:"].includes(protocol);
}

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
 * WebSocket first with HTTPS fallbacks. The caller disposes the owner at the end of the
 * turn so the sockets close and the process can exit.
 */
export function createPublicClient(
  chain: SupportedChain,
  rpcUrl?: string,
): ccc.Owner<ccc.Client> {
  publicRpcEndpointIdentity(rpcUrl);
  const config = rpcUrl === undefined ? {} : { urls: [rpcUrl] as const };
  return (chain === "mainnet" ? ccc.ClientPublicMainnet : ccc.ClientPublicTestnet).open(
    config,
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
  if (evidence.observed.genesisHash !== evidence.expected.genesisHash) {
    failures.push(
      `genesis hash expected ${evidence.expected.genesisHash} observed ${evidence.observed.genesisHash}`,
    );
  }
  if (evidence.observed.addressPrefix !== evidence.expected.addressPrefix) {
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

function invalidRpcEndpointIdentity(): TypeError {
  return new TypeError("Invalid RPC endpoint identity input");
}
