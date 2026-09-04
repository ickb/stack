import { ccc } from "@ckb-ccc/ccc";
import { Ratio } from "@ickb/order";
import { byte32FromByte, headerLike, StubClient } from "@ickb/testkit";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { l1StateQueryKey } from "../../src/query/l1StateQueryKey.ts";
import {
  getL1State,
  l1StateOptions,
  quoteStateOptions,
} from "../../src/query/queries.ts";
import {
  cell,
  script,
  stateSdk,
  testClient,
  testSigner,
  walletConfigForState,
} from "./fixtures/query.ts";

function itKeysL1StateByAccountLocks(): void {
  it("keys L1 state by account locks as well as address", () => {
    const primaryLock = script("11");
    const firstAccountLock = script("22");
    const secondAccountLock = script("33");
    const walletConfig = {
      chain: "testnet",
      address: "ckt1same",
      primaryLock,
      accountLocks: [firstAccountLock],
    } satisfies Parameters<typeof l1StateQueryKey>[0];

    expect(l1StateQueryKey(walletConfig)).toEqual([
      "testnet",
      "ckt1same",
      `primary=${primaryLock.toHex()};accounts=${firstAccountLock.toHex()}`,
      "l1State",
    ]);
    expect(
      l1StateQueryKey({
        ...walletConfig,
        accountLocks: [secondAccountLock],
      }),
    ).not.toEqual(l1StateQueryKey(walletConfig));
  });
}

function itPollsLiveStateUnlessFrozen(): void {
  it("polls live state every minute unless a transaction is frozen", () => {
    const walletConfig = {
      chain: "testnet",
      cccClient: testClient(),
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
          poolDeposits: { deposits: [], id: "" },
          ckbAvailable: 0n,
          ckbMaturing: [],
        },
        user: { orders: [] },
        account: {
          capacityCells: [],
          nativeUdtCells: [],
          nativeUdtCapacity: 0n,
          nativeUdtBalance: 0n,
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
          poolDeposits: { deposits: [], id: "" },
          ckbAvailable: 0n,
          ckbMaturing: [],
        },
        user: { orders: [] },
        account: {
          capacityCells: [],
          nativeUdtCells: [],
          nativeUdtCapacity: 0n,
          nativeUdtBalance: 0n,
          receipts: [],
          withdrawalGroups: [],
        },
      }),
      false,
    );

    await expect(options.queryFn()).resolves.toMatchObject({ tipTimestamp: 42n });
  });
}

function itLoadsQuoteStateFromTip(): void {
  it("loads quote state from the tip without scanning protocol or account state", async () => {
    let tipReads = 0;
    const rootConfig = {
      chain: "testnet",
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
    } satisfies Parameters<typeof quoteStateOptions>[0];

    const options = quoteStateOptions(rootConfig);
    const state = await options.queryFn();

    expect(state.exchangeRatio.ckbScale).toBe(10000000000000000n);
    expect(state.tipTimestamp).toBe(25n);
    expect(state.exchangeRatio.udtScale).toBe(10008200000000000n);
    expect(options.queryKey.at(-1)).toBe("quoteState");
    expect(options.refetchInterval).toBe(60_000);
    expect(tipReads).toBe(1);
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
      poolDeposits: { deposits: [], id: "" },
      ckbAvailable: 0n,
      ckbMaturing: [],
    },
    user: { orders: [] },
    account: {
      capacityCells: [capacityCell],
      nativeUdtCells: [nativeUdtCell],
      nativeUdtCapacity: 7n,
      nativeUdtBalance: 11n,
      receipts: [],
      withdrawalGroups: [],
    },
  });

  const state = await getL1State(walletConfig);

  expect(state.ckbNative).toBe(nativeCapacity);
  expect(state.ickbNative).toBe(11n);
  expect(state.ckbAvailable).toBe(nativeCapacity);
  expect(state.ickbAvailable).toBe(11n);
  expect(state.ckbBalance).toBe(nativeCapacity);
  expect(state.ickbBalance).toBe(11n);
  expect(state.stateId).toBe(
    [
      "chain=testnet",
      `locks=primary=${lock.toHex()};accounts=${lock.toHex()}`,
      `tip=${tip.hash}/${String(tip.number)}/10`,
      "fee=1",
      "ratio=1/1",
      "pool=0;;;deposits=",
      `balances=${String(nativeCapacity)}/11`,
      `capacityCells=${capacityCell.outPoint.toHex()}`,
      `nativeUdtCells=${nativeUdtCell.outPoint.toHex()}`,
      "maturity=10",
      "receipts=",
      "readyWithdrawals=",
      "availableOrders=",
      "pendingWithdrawals=",
      "pendingOrders=",
    ].join("|"),
  );
  await expect(state.txBuilder(true, 1n)).resolves.toMatchObject({
    error: "No conversion request available for this amount",
    estimatedMaturity: 10n,
  });
});

it("changes stateId when transaction-preview inputs change without count changes", async () => {
  const lock = script("11");
  const tip = headerLike({ timestamp: 10n });
  const stateIdFor = async (options?: {
    feeRate?: bigint;
    exchangeRatio?: Ratio;
    nativeCapacity?: bigint;
    nativeCapacityTxHashByte?: string;
    nativeUdtTxHashByte?: string;
    ckbMaturing?: Array<{ ckbCumulative: bigint; maturity: bigint }>;
  }): Promise<string> => {
    const capacityCell = cell(options?.nativeCapacity ?? ccc.fixedPointFrom(100), lock);
    capacityCell.outPoint.txHash = byte32FromByte(
      options?.nativeCapacityTxHashByte ?? "aa",
    );
    const nativeUdtCell = cell(1n, lock);
    nativeUdtCell.outPoint.txHash = byte32FromByte(options?.nativeUdtTxHashByte ?? "bb");
    const walletConfig = walletConfigForState(lock, {
      system: {
        feeRate: options?.feeRate ?? 1n,
        tip,
        exchangeRatio:
          options?.exchangeRatio ?? Ratio.from({ ckbScale: 1n, udtScale: 1n }),
        orderPool: [],
        poolDeposits: { deposits: [], id: "" },
        ckbAvailable: 0n,
        ckbMaturing: options?.ckbMaturing ?? [],
      },
      user: { orders: [] },
      account: {
        capacityCells: [capacityCell],
        nativeUdtCells: [nativeUdtCell],
        nativeUdtCapacity: 0n,
        nativeUdtBalance: 0n,
        receipts: [],
        withdrawalGroups: [],
      },
    });

    return (await getL1State(walletConfig)).stateId;
  };

  const base = await stateIdFor();

  await expect(stateIdFor({ feeRate: 2n })).resolves.not.toBe(base);
  await expect(
    stateIdFor({
      exchangeRatio: Ratio.from({ ckbScale: 2n, udtScale: 1n }),
    }),
  ).resolves.not.toBe(base);
  await expect(stateIdFor({ nativeCapacity: ccc.fixedPointFrom(101) })).resolves.not.toBe(
    base,
  );
  await expect(stateIdFor({ nativeCapacityTxHashByte: "ab" })).resolves.not.toBe(base);
  await expect(stateIdFor({ nativeUdtTxHashByte: "bc" })).resolves.not.toBe(base);
  await expect(
    stateIdFor({
      ckbMaturing: [{ ckbCumulative: 1n, maturity: 20n }],
    }),
  ).resolves.not.toBe(base);
});
