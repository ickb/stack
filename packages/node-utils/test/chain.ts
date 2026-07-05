import { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import {
  createPublicClient,
  isRetryableRpcTransportError,
  verifyChainPreflight,
} from "../src/index.ts";
import {
  byte32FromByte,
  FETCH_FAILED_MESSAGE,
  MAINNET_GENESIS_HASH,
  preflightClient,
  RpcPreflightError,
  TESTNET_GENESIS_HASH,
} from "./support/node_utils_support.ts";

const MISSING_TESTNET_GENESIS_HEADER = "Missing testnet genesis header";
const TESTNET_PREFLIGHT_FAILURE_MESSAGE = "Failed to verify testnet RPC chain identity";

describe("public clients and preflight identity", () => {
  it("creates network-specific public clients and forwards custom RPC URLs", () => {
    const mainnet = createPublicClient("mainnet", "https://mainnet.example");
    const testnet = createPublicClient("testnet", undefined);
    const emptyConfiguredTestnet = createPublicClient("testnet", "");
    const defaultTestnet = new ccc.ClientPublicTestnet();

    expect(mainnet).toBeInstanceOf(ccc.ClientPublicMainnet);
    expect(testnet).toBeInstanceOf(ccc.ClientPublicTestnet);
    expect(mainnet.addressPrefix).toBe("ckb");
    expect(testnet.addressPrefix).toBe("ckt");
    expect(mainnet.url).toBe("https://mainnet.example");
    expect(testnet.url).toBe(defaultTestnet.url);
    expect(emptyConfiguredTestnet.url).toBe(defaultTestnet.url);
  });

  it("reads and verifies public chain identity evidence", async () => {
    const client = preflightClient({
      addressPrefix: "ckt",
      genesisHash: TESTNET_GENESIS_HASH,
      tipHash: byte32FromByte("22"),
      tipNumber: 123n,
      tipTimestamp: 456n,
    });

    await expect(verifyChainPreflight(client, "testnet")).resolves.toMatchObject({
      chain: "testnet",
      expected: {
        chain: "testnet",
        networkName: "ckb_testnet",
        genesisHash: TESTNET_GENESIS_HASH,
        genesisMessage: "aggron-v4",
        addressPrefix: "ckt",
      },
      observed: {
        genesisHash: TESTNET_GENESIS_HASH,
        addressPrefix: "ckt",
        tip: { hash: byte32FromByte("22"), number: 123n, timestamp: 456n },
      },
      matches: { genesisHash: true, addressPrefix: true },
    });
  });

  it("returns undefined for non-genesis preflight header reads", async () => {
    const client = testnetClient();

    await expect(client.getHeaderByNumber(1n)).resolves.toBeUndefined();
  });

  it("rejects mismatched public chain identity evidence", async () => {
    const client = preflightClient({
      addressPrefix: "ckb",
      genesisHash: MAINNET_GENESIS_HASH,
      tipHash: byte32FromByte("22"),
      tipNumber: 1n,
      tipTimestamp: 2n,
    });

    await expect(verifyChainPreflight(client, "testnet")).rejects.toThrow(
      `Invalid testnet RPC chain identity: genesis hash expected ${
        TESTNET_GENESIS_HASH
      } observed ${MAINNET_GENESIS_HASH}; address prefix expected ckt observed ckb`,
    );
  });

  it("rejects a missing genesis header as public identity evidence", async () => {
    const client = testnetClient();
    client.getHeaderByNumber = async (): Promise<ccc.ClientBlockHeader | undefined> => {
      await Promise.resolve();
      return undefined;
    };

    await expect(verifyChainPreflight(client, "testnet")).rejects.toThrow(
      MISSING_TESTNET_GENESIS_HEADER,
    );
  });
});

describe("preflight failure redaction", () => {
  it("hides non-public preflight failure details before loop logging starts", async () => {
    const client = testnetClient();
    client.getHeaderByNumber = async (): Promise<ccc.ClientBlockHeader | undefined> => {
      await Promise.resolve();
      throw new RpcPreflightError(
        "RPC failed via https://user:pass@testnet.example/path?token=secret",
      );
    };

    let failure: unknown;
    try {
      await verifyChainPreflight(client, "testnet");
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      message: TESTNET_PREFLIGHT_FAILURE_MESSAGE,
      cause: { name: "RpcPreflightError" },
    });
    expect(JSON.stringify(failure)).not.toMatch(/user|pass|secret|testnet\.example/u);
  });

  it("hides non-Error preflight failures before loop logging starts", async () => {
    const client = testnetClient();
    client.getHeaderByNumber = async (): Promise<ccc.ClientBlockHeader | undefined> => {
      await Promise.resolve();
      const failure = {
        reason: "failed",
        amount: 9007199254740993n,
        reasonCode: "transport",
      };
      const rejectedHeader = Promise.withResolvers<ccc.ClientBlockHeader | undefined>();
      rejectedHeader.reject(failure);
      return rejectedHeader.promise;
    };

    await expect(verifyChainPreflight(client, "testnet")).rejects.toMatchObject({
      message: TESTNET_PREFLIGHT_FAILURE_MESSAGE,
      cause: { type: "object" },
    });
  });
});

describe("preflight failure normalization", () => {
  it("normalizes string, null, and unsafe-named preflight failures", async () => {
    const stringFailure = testnetClient();
    stringFailure.getHeaderByNumber = async (): Promise<
      ccc.ClientBlockHeader | undefined
    > => {
      await Promise.resolve();
      return rejectedHeaderRead("rpc failed");
    };
    await expect(verifyChainPreflight(stringFailure, "testnet")).rejects.toMatchObject({
      message: TESTNET_PREFLIGHT_FAILURE_MESSAGE,
      cause: { type: "string" },
    });

    const nullFailure = testnetClient();
    nullFailure.getHeaderByNumber = async (): Promise<
      ccc.ClientBlockHeader | undefined
    > => {
      await Promise.resolve();
      return rejectedHeaderRead(null);
    };
    await expect(verifyChainPreflight(nullFailure, "testnet")).rejects.toMatchObject({
      message: TESTNET_PREFLIGHT_FAILURE_MESSAGE,
      cause: { type: "null" },
    });

    const unsafeNamedFailure = testnetClient();
    unsafeNamedFailure.getHeaderByNumber = async (): Promise<
      ccc.ClientBlockHeader | undefined
    > => {
      await Promise.resolve();
      const error = new Error("failed");
      Object.defineProperty(error, "name", { value: "not safe" });
      throw error;
    };
    await expect(
      verifyChainPreflight(unsafeNamedFailure, "testnet"),
    ).rejects.toMatchObject({
      message: TESTNET_PREFLIGHT_FAILURE_MESSAGE,
      cause: { name: "Error" },
    });
  });

  it("preserves public string preflight failures", async () => {
    const client = testnetClient();
    client.getHeaderByNumber = async (): Promise<ccc.ClientBlockHeader | undefined> => {
      await Promise.resolve();
      throw new Error(MISSING_TESTNET_GENESIS_HEADER);
    };

    await expect(verifyChainPreflight(client, "testnet")).rejects.toThrow(
      MISSING_TESTNET_GENESIS_HEADER,
    );
  });

  it("falls back when non-Error failure message stringification throws", async () => {
    const client = testnetClient();
    const failure = Object.defineProperty({}, "message", {
      enumerable: true,
      get: () => {
        throw new Error("getter failed");
      },
    });
    client.getHeaderByNumber = async (): Promise<ccc.ClientBlockHeader | undefined> => {
      await Promise.resolve();
      return rejectedHeaderRead(failure);
    };

    await expect(verifyChainPreflight(client, "testnet")).rejects.toMatchObject({
      message: TESTNET_PREFLIGHT_FAILURE_MESSAGE,
      cause: { type: "object" },
    });
  });
});

describe("retryable preflight failures", () => {
  it("normalizes retryable preflight transport failures", async () => {
    const client = testnetClient();
    client.getHeaderByNumber = async (): Promise<ccc.ClientBlockHeader | undefined> => {
      await Promise.resolve();
      throw new TypeError(FETCH_FAILED_MESSAGE);
    };

    await expect(verifyChainPreflight(client, "testnet")).rejects.toMatchObject({
      message: FETCH_FAILED_MESSAGE,
      cause: { name: "TypeError", message: FETCH_FAILED_MESSAGE },
    });
    let caught: unknown;
    try {
      await verifyChainPreflight(client, "testnet");
    } catch (error) {
      caught = error;
    }
    expect(isRetryableRpcTransportError(caught)).toBe(true);
  });
});

async function rejectedHeaderRead(
  failure: unknown,
): Promise<ccc.ClientBlockHeader | undefined> {
  await Promise.resolve();
  const rejectedHeader = Promise.withResolvers<ccc.ClientBlockHeader | undefined>();
  rejectedHeader.reject(failure);
  return rejectedHeader.promise;
}

function testnetClient(): ccc.Client {
  return preflightClient({
    addressPrefix: "ckt",
    genesisHash: TESTNET_GENESIS_HASH,
    tipHash: byte32FromByte("22"),
    tipNumber: 123n,
    tipTimestamp: 456n,
  });
}
