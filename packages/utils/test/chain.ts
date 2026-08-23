import { describe, expect, it } from "vitest";
import { expectedChainIdentity } from "../src/chain.ts";

describe("expectedChainIdentity", () => {
  it("owns the canonical genesis hash and address prefix for each public chain", () => {
    expect(expectedChainIdentity("mainnet")).toMatchObject({
      genesisHash: "0x92b197aa1fba0f63633922c61c92375c9c074a93e85963554f5499fe1450d0e5",
      addressPrefix: "ckb",
    });
    expect(expectedChainIdentity("testnet")).toMatchObject({
      genesisHash: "0x10639e0895502b5688a6be8cf69460d76541bfa4821629d86d62ba0aae3f9606",
      addressPrefix: "ckt",
    });
    expect(Object.isFrozen(expectedChainIdentity("mainnet"))).toBe(true);
  });
});
