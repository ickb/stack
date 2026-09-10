import { StubClient } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import { chainFromClient } from "../../src/wallet/chain.ts";

describe("chainFromClient", () => {
  it("maps supported CCC client prefixes to stack chains", () => {
    expect(chainFromClient(new StubClient({ addressPrefix: "ckb" }))).toBe("mainnet");
    expect(chainFromClient(new StubClient({ addressPrefix: "ckt" }))).toBe("testnet");
  });

  it("rejects unsupported prefixes so client and signer chains must agree", () => {
    expect(chainFromClient(new StubClient({ addressPrefix: "ckb-dev" }))).toBeUndefined();
  });
});
