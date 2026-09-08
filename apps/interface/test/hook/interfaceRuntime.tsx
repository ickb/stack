import { ccc } from "@ckb-ccc/ccc";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { childElements, elementProps, firstElement } from "../support/react.ts";
import {
  quoteStateQuery,
  rootConfig,
  signerFilterInfo,
  signerInfo,
} from "./fixtures/data.ts";
import { queryMock, quoteStateOptions } from "./fixtures/environment.ts";
import {
  activeChain,
  activeConnectedChain,
  appName,
  ckbSignerOnly,
  connectorStyle,
  createRootConfig,
  Interface,
  liveQuoteStatus,
  mainnetClient,
  queryClient,
  selectedClient,
  signerClientChain,
  testnetClient,
  useQuoteState,
  walletLabel,
} from "./fixtures/modules.ts";

describe("hook-based interface runtime", () => {
  it("wraps the wallet interface with query and CCC providers", () => {
    globalThis.localStorage.setItem("ickb-selected-chain", "testnet");
    const testnetInterface = Interface();
    const testnetProvider = cccProviderElement(testnetInterface);

    expect(
      elementProps<{ defaultClient: unknown; name: string }>(testnetProvider),
    ).toMatchObject({
      defaultClient: testnetClient,
      name: appName,
    });

    globalThis.localStorage.setItem("ickb-selected-chain", "bad");
    const mainnetProvider = cccProviderElement(Interface());
    expect(elementProps<{ defaultClient: unknown }>(mainnetProvider).defaultClient).toBe(
      mainnetClient,
    );
    expect(
      elementProps<{ signerFilter: typeof ckbSignerOnly }>(mainnetProvider).signerFilter,
    ).toBe(ckbSignerOnly);
  });

  it("renders with mainnet defaults when localStorage acquisition throws", () => {
    throwOnLocalStorageAccess();

    expect(() => Interface()).not.toThrow();
    expect(
      elementProps<{ defaultClient: unknown }>(cccProviderElement(Interface()))
        .defaultClient,
    ).toBe(mainnetClient);
  });

  it("exposes interface config and wallet gate state helpers", async () => {
    const setClient = vi.fn<(client: unknown) => unknown>();
    const root = createRootConfig("testnet", testnetClient, setClient);
    const ckbSigner = signerInfo(ccc.SignerType.CKB, "ckt");
    const btcSigner = signerInfo(ccc.SignerType.BTC, "ckt");

    expect(root).toMatchObject({
      chain: "testnet",
      cccClient: testnetClient,
      queryClient,
    });
    // A reset hands the connector a fresh client of the same chain, never the shared one.
    root.resetClient();
    expect(setClient).toHaveBeenCalledTimes(1);
    expect(setClient.mock.calls[0]?.[0]).toBeInstanceOf(ccc.ClientPublicTestnet);
    expect(setClient.mock.calls[0]?.[0]).not.toBe(testnetClient);
    expect(connectorStyle["--background"]).toBe("oklch(21% 0.006 286)");
    await expect(ckbSignerOnly(signerFilterInfo(ckbSigner))).resolves.toBe(true);
    await expect(ckbSignerOnly(signerFilterInfo(btcSigner))).resolves.toBe(false);
    expect(activeChain(undefined, undefined, "mainnet")).toBe("mainnet");
    expect(activeChain(ckbSigner, "testnet", "mainnet")).toBe("testnet");
    expect(signerClientChain(ckbSigner)).toBe("testnet");
    expect(selectedClient(undefined, mainnetClient, testnetClient)).toBe(testnetClient);
    expect(selectedClient(ckbSigner, mainnetClient, testnetClient)).toBe(mainnetClient);
    expect(activeConnectedChain(undefined, "testnet")).toBeUndefined();
    expect(activeConnectedChain(ckbSigner, "testnet")).toBe("testnet");
    expect(walletLabel("JoyID", "CKB")).toBe("JoyID CKB");
    expect(walletLabel(undefined, undefined)).toBe("Wallet");
  });

  it("loads quote state only for supported root configs", async () => {
    queryMock.result = { isError: true };
    expect(useQuoteState(undefined)).toBe(queryMock.result);
    await expect(quoteStateOptions().queryFn()).rejects.toThrow("Unsupported network");
    expect(liveQuoteStatus(quoteStateQuery(queryMock.result))).toBe(
      "Unable to load live exchange rate.",
    );

    queryMock.result = { isError: false };
    expect(useQuoteState(rootConfig("testnet"))).toBe(queryMock.result);
    expect(quoteStateOptions().enabled).toBe(true);
    expect(liveQuoteStatus(quoteStateQuery(queryMock.result))).toBe(
      "Loading live exchange rate...",
    );
  });
});

function throwOnLocalStorageAccess(): void {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get: () => {
      throw new Error("blocked");
    },
  });
}

function cccProviderElement(interfaceElement: ReactElement): ReactElement {
  const queryProvider = firstElement(childElements(interfaceElement));
  return firstElement(childElements(queryProvider));
}
