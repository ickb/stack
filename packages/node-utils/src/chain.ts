import { ccc } from "@ckb-ccc/core";
import { jsonLogReplacer, toJsonLogValue } from "./logging.ts";
import { FETCH_FAILED_MESSAGE, isRetryableRpcTransportError } from "./retryable.ts";

const UNKNOWN_ERROR_MESSAGE = "Unknown error";

/** Supported public CKB network names. */
export type SupportedChain = "mainnet" | "testnet";

interface ChainIdentity {
  chain: SupportedChain;
  networkName: string;
  genesisHash: ccc.Hex;
  genesisMessage: string;
  genesisSource: string;
  addressPrefix: "ckb" | "ckt";
}

const CHAIN_IDENTITIES = {
  mainnet: {
    chain: "mainnet",
    networkName: "ckb",
    genesisHash: "0x92b197aa1fba0f63633922c61c92375c9c074a93e85963554f5499fe1450d0e5",
    genesisMessage:
      "lina 0x18e020f6b1237a3d06b75121f25a7efa0550e4b3f44f974822f471902424c104",
    genesisSource:
      "https://raw.githubusercontent.com/nervosnetwork/ckb/develop/resource/specs/mainnet.toml",
    addressPrefix: "ckb",
  },
  testnet: {
    chain: "testnet",
    networkName: "ckb_testnet",
    genesisHash: "0x10639e0895502b5688a6be8cf69460d76541bfa4821629d86d62ba0aae3f9606",
    genesisMessage: "aggron-v4",
    genesisSource:
      "https://raw.githubusercontent.com/nervosnetwork/ckb/develop/resource/specs/testnet.toml",
    addressPrefix: "ckt",
  },
} as const satisfies Record<SupportedChain, ChainIdentity>;

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
 * Verifies that an RPC client matches the expected public chain identity.
 *
 * @remarks Public chain mismatches keep their diagnostic text; unexpected
 * failures expose only a safe error shape before loop logging adds context.
 */
export async function verifyChainPreflight(
  client: ccc.Client,
  chain: SupportedChain,
): Promise<ChainPreflightEvidence> {
  try {
    return assertChainPreflight(await readChainPreflight(client, chain));
  } catch (error) {
    if (isPublicChainPreflightFailure(error, chain)) {
      const options = {
        cause: toJsonLogValue(error, new WeakSet()),
      };
      throw new Error(errorMessage(error), options);
    }
    if (isRetryableRpcTransportError(error)) {
      const options = {
        cause: { name: "TypeError", message: FETCH_FAILED_MESSAGE },
      };
      throw new Error(FETCH_FAILED_MESSAGE, options);
    }
    const options = {
      cause: safePreflightFailureCause(error),
    };
    throw new Error(`Failed to verify ${chain} RPC chain identity`, options);
  }
}

/**
 * Creates a CCC public client for the selected chain and optional RPC URL.
 */
export function createPublicClient(
  chain: SupportedChain,
  rpcUrl: string | undefined,
): ccc.Client {
  const config = rpcUrl === undefined || rpcUrl === "" ? undefined : { url: rpcUrl };
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

function expectedChainIdentity(chain: SupportedChain): ChainIdentity {
  return CHAIN_IDENTITIES[chain];
}

function safePreflightFailureCause(error: unknown): { name: string } | { type: string } {
  if (error instanceof Error) {
    return { name: safeErrorName(error.name) };
  }
  return { type: error === null ? "null" : typeof error };
}

function safeErrorName(name: string): string {
  return /^[A-Za-z][\w.-]{0,63}$/u.test(name) ? name : "Error";
}

function isPublicChainPreflightFailure(error: unknown, chain: SupportedChain): boolean {
  const message = errorMessage(error);
  return (
    message === `Missing ${chain} genesis header` ||
    message.startsWith(`Invalid ${chain} RPC chain identity:`)
  );
}

function errorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  return error instanceof Error ? error.message : stringifyErrorMessage(error);
}

function stringifyErrorMessage(error: unknown): string {
  if (error === undefined || error === null) {
    return UNKNOWN_ERROR_MESSAGE;
  }
  try {
    return JSON.stringify(toJsonLogValue(error, new WeakSet()), jsonLogReplacer);
  } catch {
    return UNKNOWN_ERROR_MESSAGE;
  }
}
