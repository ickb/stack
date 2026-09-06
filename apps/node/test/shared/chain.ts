import { ccc } from "@ckb-ccc/core";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createPublicClient,
  publicRpcEndpointIdentity,
  verifyChainPreflight,
} from "../../src/shared/index.ts";
import {
  byte32FromByte,
  FETCH_FAILED_MESSAGE,
  MAINNET_GENESIS_HASH,
  preflightClient,
  RpcPreflightError,
  TESTNET_GENESIS_HASH,
} from "./support/node_utils_support.ts";

const MISSING_TESTNET_GENESIS_HEADER = "Missing testnet genesis header";
const MAINNET_RPC_URL = "https://mainnet.example";
const INVALID_RPC_ENDPOINT_IDENTITY = "Invalid RPC endpoint identity input";
const TESTNET_PREFLIGHT_FAILURE_MESSAGE = "Failed to verify testnet RPC chain identity";
const HTTP_CLIENT_PROCESS = fileURLToPath(
  new URL("fixtures/httpPublicClientProcess.ts", import.meta.url),
);

describe("public clients and preflight identity", () => {
  it("reduces RPC configuration to credential-free endpoint identity", () => {
    expect(
      publicRpcEndpointIdentity("https://rpc.example:8443/ckb?token=secret#private"),
    ).toEqual({
      mode: "exclusive",
      protocol: "https:",
      hostname: "rpc.example",
      port: "8443",
      pathname: "/ckb",
    });
    for (const value of [
      "",
      "invalid",
      "wss://rpc.example/ws",
      "https://user@rpc.example/",
    ]) {
      expect(() => publicRpcEndpointIdentity(value)).toThrow(
        INVALID_RPC_ENDPOINT_IDENTITY,
      );
    }
  });

  it("creates network-specific public clients with explicit RPC URLs", () => {
    const mainnet = createPublicClient("mainnet", MAINNET_RPC_URL);
    const testnetUrl = "http://127.0.0.1:8114/";
    const testnet = createPublicClient("testnet", testnetUrl);

    expect(mainnet).toBeInstanceOf(ccc.ClientPublicMainnet);
    expect(testnet).toBeInstanceOf(ccc.ClientPublicTestnet);
    expect(mainnet.addressPrefix).toBe("ckb");
    expect(testnet.addressPrefix).toBe("ckt");
    expect(mainnet.url).toBe(MAINNET_RPC_URL);
    expect(testnet.url).toBe(testnetUrl);
  });

  it("makes a configured RPC URL the exclusive endpoint pool", () => {
    const mainnetUrl = MAINNET_RPC_URL;
    const testnetUrl = "http://127.0.0.1:8114/";
    const mainnet = createPublicClient("mainnet", mainnetUrl);
    const testnet = createPublicClient("testnet", testnetUrl);
    const exclusiveMainnet = new ccc.ClientPublicMainnet({
      url: mainnetUrl,
      fallbacks: [],
    });
    const exclusiveTestnet = new ccc.ClientPublicTestnet({
      url: testnetUrl,
      fallbacks: [],
    });

    expect(endpointPoolUrls(mainnet)).toEqual(endpointPoolUrls(exclusiveMainnet));
    expect(endpointPoolUrls(testnet)).toEqual(endpointPoolUrls(exclusiveTestnet));
    expect(endpointPoolUrls(mainnet)).toEqual([mainnetUrl]);
    expect(endpointPoolUrls(testnet)).toEqual([testnetUrl]);
  });

  it("rejects omitted and empty RPC URLs instead of selecting CCC defaults", () => {
    expect(() => createPublicClient("testnet", "")).toThrow(
      INVALID_RPC_ENDPOINT_IDENTITY,
    );
    expect(() =>
      createPublicClient(
        "testnet",
        // @ts-expect-error Runtime callers must fail closed too.
        undefined,
      ),
    ).toThrow(INVALID_RPC_ENDPOINT_IDENTITY);
  });
});
describe("finite public clients", () => {
  it("lets a process exit naturally after a real HTTP client request", () => {
    const result = spawnSync(process.execPath, [HTTP_CLIENT_PROCESS], {
      encoding: "utf8",
      timeout: 5_000,
    });

    expect(result).toMatchObject({ status: 0, stdout: "completed\n", stderr: "" });
  });
});

describe("public client preflight identity", () => {
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

describe("preflight transport failures", () => {
  it("keeps the fetch failure message and drops the transport cause", async () => {
    const client = testnetClient();
    client.getHeaderByNumber = async (): Promise<ccc.ClientBlockHeader | undefined> => {
      await Promise.resolve();
      throw new TypeError(FETCH_FAILED_MESSAGE);
    };

    await expect(verifyChainPreflight(client, "testnet")).rejects.toMatchObject({
      message: FETCH_FAILED_MESSAGE,
      cause: { name: "TypeError", message: FETCH_FAILED_MESSAGE },
    });
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

function endpointPoolUrls(client: ccc.Client): string[] {
  if (!(client instanceof ccc.ClientJsonRpc)) {
    throw new TypeError("expected JSON-RPC public client");
  }
  const { transport } = client.requestor;
  if (!("transports" in transport) || !Array.isArray(transport.transports)) {
    throw new Error("expected CCC TransportFallback endpoint pool");
  }
  return transport.transports.map((entry: unknown) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      !("url" in entry) ||
      typeof entry.url !== "string"
    ) {
      throw new Error("expected transport URL");
    }
    return entry.url;
  });
}
