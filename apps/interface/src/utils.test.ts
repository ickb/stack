import { describe, expect, it } from "vitest";
import { parseWalletChain } from "./utils.ts";

describe("parseWalletChain", () => {
  it("parses supported wallet-chain identifiers", () => {
    expect(parseWalletChain("JoyID_mainnet")).toEqual({
      walletName: "JoyID",
      chain: "mainnet",
    });
    expect(parseWalletChain("JoyID_testnet")).toEqual({
      walletName: "JoyID",
      chain: "testnet",
    });
    expect(parseWalletChain("Wallet_With_Underscores_testnet")).toEqual({
      walletName: "Wallet_With_Underscores",
      chain: "testnet",
    });
  });

  it("rejects missing or unsupported chains instead of defaulting", () => {
    expect(() => parseWalletChain("JoyID")).toThrow("Unsupported wallet chain: JoyID");
    expect(() => parseWalletChain("JoyID_devnet")).toThrow("Unsupported wallet chain: JoyID_devnet");
    expect(() => parseWalletChain("JoyID_testnet_extra")).toThrow(
      "Unsupported wallet chain: JoyID_testnet_extra",
    );
  });
});
