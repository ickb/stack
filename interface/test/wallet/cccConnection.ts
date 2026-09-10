import { describe, expect, it } from "vitest";
import {
  hasSavedCccConnection,
  savedSelectedChain,
  saveSelectedChain,
} from "../../src/wallet/cccConnection.ts";

describe("hasSavedCccConnection", () => {
  it("recognizes CCC wallet and signer persistence", () => {
    expect(
      hasSavedCccConnection(
        storageOf({
          walletName: "JoyID",
          signerName: "CKB",
        }),
      ),
    ).toBe(true);
  });

  it("requires both wallet and signer names", () => {
    expect(hasSavedCccConnection(storageOf({ walletName: "JoyID" }))).toBe(false);
    expect(hasSavedCccConnection(storageOf({ signerName: "CKB" }))).toBe(false);
    expect(hasSavedCccConnection(storageOf({ walletName: "", signerName: "CKB" }))).toBe(
      false,
    );
  });

  it("ignores invalid saved values", () => {
    expect(hasSavedCccConnection(storageOf(undefined))).toBe(false);
    expect(hasSavedCccConnection(storageOf([]))).toBe(false);
    expect(hasSavedCccConnection({ getItem: () => "not-json" })).toBe(false);
  });
});

describe("selected chain persistence", () => {
  it("reads saved mainnet or testnet selections", () => {
    expect(savedSelectedChain(storageWithItem("mainnet"))).toBe("mainnet");
    expect(savedSelectedChain(storageWithItem("testnet"))).toBe("testnet");
  });

  it("falls back when storage is empty or invalid", () => {
    expect(savedSelectedChain(storageWithItem(null))).toBeUndefined();
    expect(savedSelectedChain(storageWithItem("devnet"))).toBeUndefined();
    expect(
      savedSelectedChain({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toBeUndefined();
  });

  it("saves selected chains when storage is available", () => {
    let saved = "";
    saveSelectedChain("testnet", {
      setItem: (_key, value) => {
        saved = value;
      },
    });

    expect(saved).toBe("testnet");
  });

  it("ignores save failures", () => {
    expect(() => {
      saveSelectedChain("testnet", {
        setItem: () => {
          throw new Error("blocked");
        },
      });
    }).not.toThrow();
  });
});

function storageOf(value: unknown): Pick<Storage, "getItem"> {
  return {
    getItem: () => (value === undefined ? null : JSON.stringify(value)),
  };
}

function storageWithItem(value: string | null): Pick<Storage, "getItem"> {
  return { getItem: () => value };
}
