import { describe, expect, it } from "vitest";
import { walletConfigQueryKey } from "../../src/query/walletConfigQueryKey.ts";

describe("walletConfigQueryKey", () => {
  it("keys wallet config by root config identity, signer object, and signer version", () => {
    const rootConfig = {
      chain: "testnet",
      cccClient: {},
      queryClient: {},
      sdk: {},
    } satisfies Parameters<typeof walletConfigQueryKey>[0];
    const signerA = {};
    const signerB = {};
    const key = walletConfigQueryKey(rootConfig, signerA, 0);

    expect(key[0]).toBe("testnet");
    expect(key.at(-1)).toBe("walletConfig");
    expect(walletConfigQueryKey(rootConfig, signerB, 0)).not.toEqual(key);
    expect(walletConfigQueryKey(rootConfig, signerA, 1)).not.toEqual(key);
    for (const override of ["cccClient", "queryClient", "sdk"] as const) {
      expect(
        walletConfigQueryKey(
          {
            ...rootConfig,
            [override]: {},
          },
          signerA,
          0,
        ),
      ).not.toEqual(key);
    }
  });
});
