import { afterEach, describe, expect, it, vi } from "vitest";
import { hasSavedCccConnection } from "../../src/wallet/cccConnection.ts";

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
    { walletName: "JoyID", signerName: "" },
    { walletName: ["JoyID"], signerName: "CKB" },
    { walletName: "JoyID", signerName: ["CKB"] },
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
