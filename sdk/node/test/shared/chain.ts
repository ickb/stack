import type { ccc } from "@ckb-ccc/core";
import { headerLike, StubClient } from "@ickb/testkit";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { jsonRpcRequestor } from "../../../src/utils/utils.ts";
import { createPublicClient, verifyChainPreflight } from "../../src/shared/chain.ts";

const TESTNET_GENESIS_HASH =
  "0x10639e0895502b5688a6be8cf69460d76541bfa4821629d86d62ba0aae3f9606";
const MAINNET_GENESIS_HASH =
  "0x92b197aa1fba0f63633922c61c92375c9c074a93e85963554f5499fe1450d0e5";

/** A client that answers only the genesis header read, with `genesisHash`. */
function preflightClient(genesisHash: `0x${string}`): ccc.Client {
  return new StubClient({
    getHeaderByNumber: async (
      blockNumber,
    ): Promise<ccc.ClientBlockHeader | undefined> => {
      await Promise.resolve();
      return blockNumber === 0n
        ? headerLike({ hash: genesisHash, number: 0n })
        : undefined;
    },
  });
}

const MISSING_TESTNET_GENESIS_HEADER = "Missing testnet genesis header";
const MAINNET_RPC_URL = "https://mainnet.example";
const HTTP_CLIENT_PROCESS = fileURLToPath(
  new URL("fixtures/httpPublicClientProcess.ts", import.meta.url),
);

describe("public clients and preflight identity", () => {
  it("opens network-specific public clients owned by the caller", async () => {
    const testnetUrl = "http://127.0.0.1:8114/";
    const mainnet = createPublicClient("mainnet", [MAINNET_RPC_URL]);
    const testnet = createPublicClient("testnet", [testnetUrl]);

    expect(mainnet.value.addressPrefix).toBe("ckb");
    expect(testnet.value.addressPrefix).toBe("ckt");
    // A configured URL is the only endpoint: an operator's node gets no public fallbacks.
    expect(endpointPoolUrls(mainnet.value)).toEqual([MAINNET_RPC_URL]);
    expect(endpointPoolUrls(testnet.value)).toEqual([testnetUrl]);
    await mainnet.dispose();
    expect(mainnet.isValid).toBe(false);
    await testnet.dispose();
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
  it("accepts the chain's genesis", async () => {
    await expect(
      verifyChainPreflight(preflightClient(TESTNET_GENESIS_HASH), "testnet"),
    ).resolves.toBeUndefined();
    await expect(
      verifyChainPreflight(preflightClient(MAINNET_GENESIS_HASH), "mainnet"),
    ).resolves.toBeUndefined();
  });

  it("rejects another chain's genesis", async () => {
    await expect(
      verifyChainPreflight(preflightClient(MAINNET_GENESIS_HASH), "testnet"),
    ).rejects.toThrow(
      `Invalid testnet RPC chain identity: genesis hash expected ${
        TESTNET_GENESIS_HASH
      } observed ${MAINNET_GENESIS_HASH}`,
    );
  });

  it("rejects a missing genesis header as public identity evidence", async () => {
    const client = preflightClient(TESTNET_GENESIS_HASH);
    client.getHeaderByNumber = async (): Promise<ccc.ClientBlockHeader | undefined> => {
      await Promise.resolve();
      return undefined;
    };

    await expect(verifyChainPreflight(client, "testnet")).rejects.toThrow(
      MISSING_TESTNET_GENESIS_HEADER,
    );
  });
});

function endpointPoolUrls(client: ccc.Client): string[] {
  const requestor = jsonRpcRequestor(client);
  const { transport } = requestor;
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
