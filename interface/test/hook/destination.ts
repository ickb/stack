import { ccc } from "@ckb-ccc/ccc";
import { script } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import { walletConfig } from "./fixtures/data.ts";
import { hookState, resetHooks } from "./fixtures/environment.ts";
import { mainnetClient, testnetClient } from "./fixtures/modules.ts";

const destinationModule = await import("../../src/action/destination.ts");
const { parseDestination, shortAddress, useDestination } = destinationModule;

const flush = async (): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
};

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
    expect(shortAddress("ckt1qzdabcdefghijklmnopqrstuvwxyz")).toBe("ckt1qzda…uvwxyz");
  });
});

describe("useDestination", () => {
  it("takes the wallet's own address without parsing", async () => {
    resetHooks();
    const config = walletConfig();

    expect(useDestination(config.address, config)).toEqual({
      destination: { lock: config.primaryLock },
      error: "",
    });
    await flush();
    expect(hookState.states[0]).toBeUndefined();
  });

  it("parses an edited address once and reports it, or its error", async () => {
    resetHooks();
    const config = walletConfig();
    const foreign = ccc.Address.fromScript(script("22"), testnetClient).toString();

    expect(useDestination(foreign, config)).toEqual({ error: "" });
    await flush();
    rerender();
    expect(useDestination(foreign, config)).toEqual({
      destination: { lock: script("22"), moveTo: shortAddress(foreign) },
      error: "",
    });

    // The text changed: the parse in flight is dropped before the next one starts.
    rerender();
    expect(useDestination("nope", config)).toEqual({ error: "" });
    await flush();
    rerender();
    expect(useDestination("nope", config)).toEqual({
      error: "Enter a valid Testnet address",
    });
  });

  it("drops a parse the text outran", async () => {
    resetHooks();
    const config = walletConfig();
    const foreign = ccc.Address.fromScript(script("22"), testnetClient).toString();

    useDestination(foreign, config);
    rerender();
    useDestination("nope", config);
    rerender();
    await flush();
    expect(hookState.states[0]).toBeUndefined();
  });
});

/** The mocked React runs every effect on every call, so a rerender cleans the last ones up. */
function rerender(): void {
  for (const cleanup of hookState.effects) {
    cleanup();
  }
  hookState.effects = [];
  hookState.index = 0;
}
