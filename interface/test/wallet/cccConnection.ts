import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hasSavedCccConnection,
  savedSelectedChain,
  saveSelectedChain,
} from "../../src/wallet/cccConnection.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("hasSavedCccConnection", () => {
  it("recognizes CCC wallet and signer persistence", () => {
    stubStorage({
      "ccc-connection-info": JSON.stringify({ walletName: "JoyID", signerName: "CKB" }),
    });
    expect(hasSavedCccConnection()).toBe(true);
  });

  it.each([
    { walletName: "JoyID" },
    { signerName: "CKB" },
    { walletName: "", signerName: "CKB" },
    [],
  ])("requires both wallet and signer names: %j", (saved) => {
    stubStorage({ "ccc-connection-info": JSON.stringify(saved) });
    expect(hasSavedCccConnection()).toBe(false);
  });

  it("ignores missing, empty, invalid, or unreadable saved values", () => {
    stubStorage({});
    expect(hasSavedCccConnection()).toBe(false);
    stubStorage({ "ccc-connection-info": "" });
    expect(hasSavedCccConnection()).toBe(false);
    stubStorage({ "ccc-connection-info": "not-json" });
    expect(hasSavedCccConnection()).toBe(false);
    vi.unstubAllGlobals();
    expect(hasSavedCccConnection()).toBe(false);
  });
});

describe("selected chain persistence", () => {
  it("reads saved mainnet or testnet selections", () => {
    stubStorage({ "ickb-selected-chain": "mainnet" });
    expect(savedSelectedChain()).toBe("mainnet");
    stubStorage({ "ickb-selected-chain": "testnet" });
    expect(savedSelectedChain()).toBe("testnet");
  });

  it("falls back when storage is empty, invalid, or unreadable", () => {
    stubStorage({});
    expect(savedSelectedChain()).toBeUndefined();
    stubStorage({ "ickb-selected-chain": "devnet" });
    expect(savedSelectedChain()).toBeUndefined();
    vi.unstubAllGlobals();
    expect(savedSelectedChain()).toBeUndefined();
  });

  it("saves selected chains when storage is available", () => {
    const saved = stubStorage({});
    saveSelectedChain("testnet");

    expect(saved.get("ickb-selected-chain")).toBe("testnet");
  });

  it("ignores save failures", () => {
    vi.unstubAllGlobals();
    expect(() => {
      saveSelectedChain("testnet");
    }).not.toThrow();
  });
});

/** Vitest runs in Node, where `localStorage` is absent: a map stands in for the browser's. */
function stubStorage(items: Record<string, string>): Map<string, string> {
  const saved = new Map(Object.entries(items));
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => {
      saved.set(key, value);
    },
  });
  return saved;
}
