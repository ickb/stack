import { describe, expect, it } from "vitest";
import { rootConfigQueryKey } from "../../src/query/rootConfigQueryKey.ts";
import { rootConfig } from "../hook/fixtures/data.ts";

describe("rootConfigQueryKey", () => {
  it("keys root-scoped client reads by chain and client identity", () => {
    const config = rootConfig("testnet");
    const key = rootConfigQueryKey(config);

    expect(key[0]).toBe("testnet");
    expect(key.at(-1)).toBe("rootConfig");
    expect(rootConfigQueryKey({ ...config })).toEqual(key);
    expect(rootConfigQueryKey({ ...config, chain: "mainnet" })).not.toEqual(key);
    expect(
      rootConfigQueryKey({ ...config, cccClient: rootConfig("mainnet").cccClient }),
    ).not.toEqual(key);
  });
});
