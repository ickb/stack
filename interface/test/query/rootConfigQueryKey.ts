import { describe, expect, it } from "vitest";
import { rootConfigQueryKey } from "../../src/query/rootConfigQueryKey.ts";

describe("rootConfigQueryKey", () => {
  it("keys root-scoped client reads by chain and client identity", () => {
    const rootConfig = {
      chain: "testnet",
      cccClient: {},
      queryClient: {},
      sdk: {},
    } satisfies Parameters<typeof rootConfigQueryKey>[0] & {
      queryClient: object;
      sdk: object;
    };
    const key = rootConfigQueryKey(rootConfig);

    expect(key[0]).toBe("testnet");
    expect(key.at(-1)).toBe("rootConfig");
    expect(
      rootConfigQueryKey({
        chain: rootConfig.chain,
        cccClient: rootConfig.cccClient,
      }),
    ).toEqual(key);
    expect(
      rootConfigQueryKey({
        chain: rootConfig.chain,
        cccClient: rootConfig.cccClient,
      }),
    ).toEqual(key);
    for (const override of ["chain", "cccClient"] as const) {
      expect(
        rootConfigQueryKey({
          ...rootConfig,
          [override]: override === "chain" ? "mainnet" : {},
        }),
      ).not.toEqual(key);
    }
  });
});
