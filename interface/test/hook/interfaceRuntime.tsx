import { ccc } from "@ckb-ccc/ccc";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
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
    const client = new ccc.ClientPublicTestnet({
      url: "https://testnet.ckb.dev/",
      fallbacks: [],
    });
    const cache = client.cache;
    const root = createRootConfig("testnet", client);
    const ckbSigner = signerInfo(ccc.SignerType.CKB, "ckt");
    const btcSigner = signerInfo(ccc.SignerType.BTC, "ckt");

    expect(root).toMatchObject({ chain: "testnet", cccClient: client, queryClient });
    // A reset swaps the cache on the same client: no new client, so nothing keyed on it remounts.
    root.resetClient();
    expect(root.cccClient).toBe(client);
    expect(client.cache).toBeInstanceOf(ccc.ClientCacheMemory);
    expect(client.cache).not.toBe(cache);
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
