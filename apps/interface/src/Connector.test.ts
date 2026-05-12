import { describe, expect, it } from "vitest";
import { connectorWalletConfigQueryKey } from "./connectorQueryKey.ts";
import type { RootConfig } from "./utils.ts";

describe("connectorWalletConfigQueryKey", () => {
  it("keys wallet config by root config identity, wallet, and signer object", () => {
    const rootConfig = {
      chain: "testnet",
      cccClient: {},
      queryClient: {},
      sdk: {},
    } as RootConfig;
    const signerA = 1;
    const signerB = 2;
    const key = connectorWalletConfigQueryKey(rootConfig, "JoyID", signerA, 0);

    expect(key[0]).toBe("testnet");
    expect(key.slice(4)).toEqual(["JoyID", signerA, 0, "walletConfig"]);
    expect(connectorWalletConfigQueryKey(rootConfig, "JoyID", signerB, 0)).not.toEqual(
      key,
    );
    expect(connectorWalletConfigQueryKey(rootConfig, "JoyID", signerA, 1)).not.toEqual(
      key,
    );
    expect(connectorWalletConfigQueryKey({
      ...rootConfig,
      sdk: {} as RootConfig["sdk"],
    }, "JoyID", signerA, 0)).not.toEqual(
      key,
    );
  });
});
