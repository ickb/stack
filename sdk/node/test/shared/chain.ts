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
  MAINNET_GENESIS_HASH,
  preflightClient,
  TESTNET_GENESIS_HASH,
} from "./support/node_utils_support.ts";

const MISSING_TESTNET_GENESIS_HEADER = "Missing testnet genesis header";
const MAINNET_RPC_URL = "https://mainnet.example";
const INVALID_RPC_ENDPOINT_IDENTITY = "Invalid RPC endpoint identity input";
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
