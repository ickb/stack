import { ccc } from "@ckb-ccc/ccc";
import { script } from "@ickb/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseDestination,
  shortAddress,
  useDestination,
} from "../../src/action/destination.ts";
import { mainnetClient, testnetClient } from "../../src/app/interfaceConfig.ts";
import type { WalletConfig } from "../../src/shared/utils.ts";
import { renderHook, settle } from "../support/renderHook.ts";

describe("parseDestination", () => {
  it("resolves a full address on the wallet's chain and names it when foreign", async () => {
    const config = walletConfig();
    const foreign = ccc.Address.fromScript(script("22"), testnetClient).toString();
    const own = ccc.Address.fromScript(script("11"), testnetClient).toString();

    await expect(parseDestination(` ${foreign} `, config)).resolves.toEqual({
      lock: script("22"),
      moveTo: shortAddress(foreign),
    });
    await expect(parseDestination(own, config)).resolves.toEqual({ lock: script("11") });
  });

  it("rejects text that is not an address on the wallet's chain", async () => {
    const mainnetAddress = ccc.Address.fromScript(script("22"), mainnetClient).toString();

    await expect(parseDestination("nope", walletConfig())).rejects.toThrow(
      "Enter a valid Testnet address",
    );
    await expect(parseDestination(mainnetAddress, walletConfig())).rejects.toThrow(
      "Enter a valid Testnet address",
    );
    await expect(
      parseDestination("nope", {
        ...walletConfig(),
        chain: "mainnet",
        cccClient: mainnetClient,
      }),
    ).rejects.toThrow("Enter a valid Mainnet address");
  });

  it("shortens an address to its ends", () => {
    expect(shortAddress("ckt1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhxqd5v3my")).toBe(
      "ckt1qxy2kg...xqd5v3my",
    );
    expect(shortAddress("ckt1short")).toBe("ckt1short");
  });
});

describe("useDestination", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("takes empty text as the wallet's own address without parsing", async () => {
    const config = walletConfig();
    const fromString = vi.spyOn(ccc.Address, "fromString");
    const { result, unmount } = await renderHook(
      (text: string) => useDestination(text, config),
      "",
    );

    expect(result.current).toEqual({
      destination: { lock: config.primaryLock },
      error: "",
    });
    expect(fromString).not.toHaveBeenCalled();
    await unmount();
  });

  it("parses an edited address once and reports it, or its error", async () => {
    const config = walletConfig();
    const foreign = ccc.Address.fromScript(script("22"), testnetClient).toString();
    const { result, rerender, unmount } = await renderHook(
      (text: string) => useDestination(text, config),
      foreign,
    );

    // act drains the parse's microtasks, so each render resolves before it returns.
    expect(result.current).toEqual({
      destination: { lock: script("22"), moveTo: shortAddress(foreign) },
      error: "",
    });
    await rerender("nope");
    expect(result.current).toEqual({ error: "Enter a valid Testnet address" });
    await unmount();
  });

  it("drops a parse the text outran", async () => {
    const config = walletConfig();
    const foreign = ccc.Address.fromScript(script("22"), testnetClient).toString();
    const slow = Promise.withResolvers<ccc.Address>();
    vi.spyOn(ccc.Address, "fromString").mockReturnValueOnce(slow.promise);
    const { result, rerender, unmount } = await renderHook(
      (text: string) => useDestination(text, config),
      foreign,
    );

    expect(result.current).toEqual({ error: "" });
    await rerender("nope");
    expect(result.current).toEqual({ error: "Enter a valid Testnet address" });
    // The first parse lands last; taking it would leave "nope" without a result.
    slow.resolve(ccc.Address.fromScript(script("22"), testnetClient));
    await settle();
    expect(result.current).toEqual({ error: "Enter a valid Testnet address" });
    await unmount();
  });
});

/** The wallet fields destination parsing reads. */
function walletConfig(): WalletConfig {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- Destination parsing reads only the chain, its client and the wallet's locks.
  return {
    chain: "testnet",
    cccClient: testnetClient,
    accountLocks: [script("11")],
    primaryLock: script("11"),
  } as unknown as WalletConfig;
}
