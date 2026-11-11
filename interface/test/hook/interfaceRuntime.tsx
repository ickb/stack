import { ccc } from "@ckb-ccc/ccc";
import { ickb } from "@ickb/sdk";
import { offlineTestnetClient } from "@ickb/testkit";
import { skipToken } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { childElements, elementProps, firstElement } from "../support/react.ts";
import { renderHook } from "../support/renderHook.ts";
import { quoteStateQuery, rootConfig } from "./fixtures/data.ts";
import { queryMock, quoteStateOptions } from "./fixtures/environment.ts";
import {
  createRootConfig,
  Interface,
  liveQuoteStatus,
  mainnetClient,
  queryClient,
  testnetClient,
  useQuoteState,
  walletLabel,
  type RootConfig,
} from "./fixtures/modules.ts";

describe("hook-based interface runtime", () => {
  it("wraps the wallet interface with query and CCC providers", () => {
    const mainnetProvider = cccProviderElement(Interface());

    // The app lands on mainnet; the connector's network list switches it.
    expect(
      elementProps<{ defaultClient: unknown; name: string }>(mainnetProvider),
    ).toMatchObject({
      defaultClient: mainnetClient,
      name: "iCKB DApp",
    });
    // The connector's look, pinned as the layout is (README, Layout).
    const { icon, connectorProps } = elementProps<{
      icon: string;
      connectorProps: unknown;
    }>(mainnetProvider);
    expect({ icon, connectorProps }).toMatchSnapshot("connector icon and style");
    // Every CCC signer is offered: EVM, BTC and Nostr wallets sign through their CKB locks.
    expect(
      elementProps<{ signerFilter?: unknown }>(mainnetProvider).signerFilter,
    ).toBeUndefined();
    // The wallet modal's network switch lists both chains.
    expect(
      elementProps<{ clientOptions: unknown }>(mainnetProvider).clientOptions,
    ).toEqual([
      { name: "Mainnet", client: mainnetClient },
      { name: "Testnet", client: testnetClient },
    ]);
    // Both clients hold the SDK's pool-sized cache, not CCC's smaller default.
    for (const client of [mainnetClient, testnetClient]) {
      expect(client.cache).toEqual(new ccc.ClientCacheMemory(...ickb.CACHE_SIZES));
    }
  });

  it("exposes interface config helpers", () => {
    const client = offlineTestnetClient();
    const cache = client.cache;
    const root = createRootConfig("testnet", client);

    expect(root).toMatchObject({ chain: "testnet", cccClient: client, queryClient });
    // A reset swaps the cache on the same client: no new client, so nothing keyed on it remounts.
    root.resetClient();
    expect(root.cccClient).toBe(client);
    expect(client.cache).toBeInstanceOf(ccc.ClientCacheMemory);
    expect(client.cache).not.toBe(cache);
    expect(walletLabel("JoyID", "CKB")).toBe("JoyID CKB");
    expect(walletLabel(undefined, undefined)).toBe("Wallet");
  });

  it("loads quote state only for supported root configs", async () => {
    queryMock.result = { isError: true };
    const { result, rerender, unmount } = await renderHook(
      (config: RootConfig | undefined) => useQuoteState(config),
      undefined,
    );
    expect(result.current).toBe(queryMock.result);
    expect(quoteStateOptions().queryFn).toBe(skipToken);
    expect(liveQuoteStatus(quoteStateQuery(queryMock.result))).toBe(
      "Unable to load live exchange rate.",
    );

    queryMock.result = { isError: false };
    await rerender(rootConfig("testnet"));
    expect(result.current).toBe(queryMock.result);
    expect(quoteStateOptions().queryFn).not.toBe(skipToken);
    expect(liveQuoteStatus(quoteStateQuery(queryMock.result))).toBe(
      "Loading live exchange rate...",
    );
    await unmount();
  });
});

function cccProviderElement(interfaceElement: ReactElement): ReactElement {
  const queryProvider = firstElement(childElements(interfaceElement));
  return firstElement(childElements(queryProvider));
}
