import { ccc } from "@ckb-ccc/ccc";
import { Ratio } from "@ickb/sdk";

import { headerLike, StubClient } from "@ickb/testkit";
import { QueryClient, skipToken } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { l1StateQueryKey } from "../../src/query/l1StateQueryKey.ts";
import {
  getL1State,
  l1StateOptions,
  quoteStateOptions,
} from "../../src/query/queries.ts";
import type { RootConfig } from "../../src/shared/utils.ts";
import { rootConfig as testRootConfig } from "../hook/fixtures/data.ts";
import {
  cell,
  script,
  stateSdk,
  testClient,
  testSigner,
  walletConfigForState,
} from "./fixtures/query.ts";

function itKeysL1StateByAccountLocks(): void {
  it("keys L1 state by the wallet config object, not its shape", () => {
    const walletConfig = { chain: "testnet", address: "ckt1same" } as const;
    const key = l1StateQueryKey(walletConfig);

    expect(key).toEqual(["testnet", "ckt1same", key[2], "l1State"]);
    expect(l1StateQueryKey(walletConfig)).toEqual(key);
    expect(l1StateQueryKey({ ...walletConfig })).not.toEqual(key);
  });
}

function itPollsLiveStateUnlessFrozen(): void {
  it("polls live state every minute unless a transaction is frozen", () => {
    const walletConfig = {
      chain: "testnet",
      cccClient: testClient(),
      resetClient: vi.fn<() => void>(),
      queryClient: new QueryClient(),
      signer: testSigner(),
      address: "ckt1same",
      primaryLock: script("11"),
      accountLocks: [script("22")],
      sdk: stateSdk({
        system: {
          feeRate: 1n,
          tip: headerLike({ timestamp: 0n }),
          exchangeRatio: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
          orderPool: [],
          poolDeposits: [],
        },
        user: { orders: [] },
        account: {
          capacityCells: [],
          nativeUdtCells: [],
          receipts: [],
          withdrawalGroups: [],
        },
      }),
    } satisfies Parameters<typeof l1StateOptions>[0];

    expect(l1StateOptions(walletConfig, false).enabled).toBe(true);
    expect(l1StateOptions(walletConfig, true).enabled).toBe(false);
    expect(l1StateOptions(walletConfig, false).refetchInterval).toBe(60_000);
  });
}

function itRunsL1StateOptionsQuery(): void {
  it("runs L1 state through the query option function", async () => {
    const lock = script("11");
    const options = l1StateOptions(
      walletConfigForState(lock, {
        system: {
          feeRate: 1n,
          tip: headerLike({ timestamp: 42n }),
          exchangeRatio: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
          orderPool: [],
          poolDeposits: [],
        },
        user: { orders: [] },
        account: {
          capacityCells: [],
          nativeUdtCells: [],
          receipts: [],
          withdrawalGroups: [],
        },
      }),
      false,
    );

    await expect(options.queryFn()).resolves.toMatchObject({
      system: { tip: { timestamp: 42n } },
    });
  });
}

function itLoadsQuoteStateFromTip(): void {
  it("loads quote state from the tip without scanning protocol or account state", async () => {
    let tipReads = 0;
    const rootConfig: RootConfig = {
      ...testRootConfig("testnet"),
      cccClient: new StubClient({
        getTipHeader: async (): Promise<ccc.ClientBlockHeader> => {
          await Promise.resolve();
          tipReads += 1;
          return headerLike({
            timestamp: 25n,
            dao: { ar: 10000000000000000n, c: 0n, s: 0n, u: 0n },
          });
        },
      }),
    };

    const options = quoteStateOptions(rootConfig);
    if (options.queryFn === skipToken) {
      throw new Error("A configured chain has a quote query");
    }
    const state = await options.queryFn();

    expect(state.exchangeRatio.ckbScale).toBe(10000000000000000n);
    expect(state.tipTimestamp).toBe(25n);
    expect(state.exchangeRatio.udtScale).toBe(10008200000000000n);
    expect(options.queryKey.at(-1)).toBe("quoteState");
    expect(options.refetchInterval).toBe(60_000);
    expect(tipReads).toBe(1);
    // An unsupported chain parks the query under a key that tolerates the missing config.
    const parked = quoteStateOptions(undefined);
    expect(parked.queryFn).toBe(skipToken);
    expect(parked.queryKey).toEqual(["unsupported", "quoteState"]);
  });
}

describe("getL1State", () => {
  itKeysL1StateByAccountLocks();
  itPollsLiveStateUnlessFrozen();
  itRunsL1StateOptionsQuery();
  itLoadsQuoteStateFromTip();
});

it("loads display balances from an SDK account snapshot", async () => {
  const lock = script("11");
  const tip = headerLike({ timestamp: 10n });
  const nativeCapacity = ccc.fixedPointFrom(50);
  const capacityCell = cell(nativeCapacity, lock);
  const nativeUdtCell = cell(7n, lock, ccc.hexFrom(ccc.numLeToBytes(11n, 16)));
  const walletConfig = walletConfigForState(lock, {
    system: {
      feeRate: 1n,
      tip,
      exchangeRatio: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
      orderPool: [],
      poolDeposits: [],
    },
    user: { orders: [] },
    account: {
      capacityCells: [capacityCell],
      nativeUdtCells: [nativeUdtCell],
      receipts: [],
      withdrawalGroups: [],
    },
  });

  const state = await getL1State(walletConfig);

  // The iCKB cell's capacity is the account's CKB too (decisions amendment 52(ah)).
  const liquidCapacity = nativeCapacity + nativeUdtCell.cellOutput.capacity;
  expect(state.projection).toMatchObject({
    ckbNative: liquidCapacity,
    ickbNative: 11n,
    ckbAvailable: liquidCapacity,
    ickbAvailable: 11n,
    ckbBalance: liquidCapacity,
    ickbBalance: 11n,
  });
  expect(state.stateId).toMatch(/^\d+$/u);
  await expect(state.txBuilder(true, 1n, { lock: script("11") })).resolves.toMatchObject({
    error: "No conversion request available for this amount",
    estimatedMaturity: 10n,
  });
});

it("gives every fetch its own stateId, so each poll rebuilds the preview", async () => {
  const lock = script("11");
  const sampledState = (): Parameters<typeof walletConfigForState>[1] => ({
    system: {
      feeRate: 1n,
      tip: headerLike({ timestamp: 10n }),
      exchangeRatio: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
      orderPool: [],
      poolDeposits: [],
    },
    user: { orders: [] },
    account: {
      capacityCells: [cell(ccc.fixedPointFrom(100), lock)],
      nativeUdtCells: [],
      receipts: [],
      withdrawalGroups: [],
    },
  });

  const first = await getL1State(walletConfigForState(lock, sampledState()));
  const second = await getL1State(walletConfigForState(lock, sampledState()));

  expect(first.stateId).not.toBe(second.stateId);
});
