import { ccc } from "@ckb-ccc/core";
import {
  type ChainIdentity,
  expectedChainIdentity,
  type SupportedChain,
} from "@ickb/sdk";

export type { SupportedChain } from "@ickb/sdk";

/** Public, credential-free identity for one RPC endpoint policy. */
export interface PublicRpcEndpointIdentity {
  mode: "exclusive";
  protocol: "http:" | "https:";
  hostname: string;
  port: string;
  pathname: string;
}

/** Reduces a configured RPC URL to the public fields needed for runtime identity. */
export function publicRpcEndpointIdentity(rpcUrl: string): PublicRpcEndpointIdentity {
  let url: URL;
  try {
    url = new URL(rpcUrl);
  } catch {
    throw invalidRpcEndpointIdentity();
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== ""
  ) {
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
 * Creates a CCC public client for the selected chain and required RPC URL.
 *
 * @remarks `rpcUrl` is the exclusive endpoint pool (`fallbacks: []`); CCC
 * would otherwise retain public fallbacks beside a custom primary URL.
 */
export function createPublicClient(chain: SupportedChain, rpcUrl: string): ccc.Client {
  publicRpcEndpointIdentity(rpcUrl);
  const config = { url: rpcUrl, fallbacks: [] };
  return chain === "mainnet"
    ? new ccc.ClientPublicMainnet(config)
    : new ccc.ClientPublicTestnet(config);
}

async function readChainPreflight(
  client: ccc.Client,
  chain: SupportedChain,
): Promise<ChainPreflightEvidence> {
  const expected = expectedChainIdentity(chain);
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
