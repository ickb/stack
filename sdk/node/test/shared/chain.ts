import type { ccc } from "@ckb-ccc/core";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { jsonRpcRequestor } from "../../../src/utils/utils.ts";
import { createPublicClient, verifyChainPreflight } from "../../src/shared/chain.ts";
import {
  MAINNET_GENESIS_HASH,
  preflightClient,
  TESTNET_GENESIS_HASH,
} from "./support/node_utils_support.ts";

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
  it("accepts the chain's genesis and journals it", async () => {
    await expect(
      verifyChainPreflight(preflightClient(TESTNET_GENESIS_HASH), "testnet"),
    ).resolves.toEqual({ genesisHash: TESTNET_GENESIS_HASH });
    await expect(
      verifyChainPreflight(preflightClient(MAINNET_GENESIS_HASH), "mainnet"),
    ).resolves.toEqual({ genesisHash: MAINNET_GENESIS_HASH });
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
