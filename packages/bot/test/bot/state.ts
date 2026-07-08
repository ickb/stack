import { ccc } from "@ckb-ccc/core";
import type { IckbDepositCell } from "@ickb/core";
import { MasterCell, OrderGroup, Ratio } from "@ickb/order";
import type { IckbSdk } from "@ickb/sdk";
import { headerLike, script } from "@ickb/testkit";
import { describe, expect, it, vi } from "vitest";
import { readBotState } from "../../src/index.ts";
import { POOL_MAX_LOCK_UP, POOL_MIN_LOCK_UP } from "../../src/policy.ts";
import { botRuntime, NO_DEPOSITS, readyDeposit, testMatch } from "./fixtures/bot.ts";

describe("readBotState pool snapshot validation", () => {
  it("partitions SDK pool deposits without a second pool scan", async () => {
    const tip = headerLike({ number: 10n, epoch: [0n, 0n, 1n], timestamp: "0x0" });
    const readyWindowEnd = POOL_MAX_LOCK_UP.add(tip.epoch).toUnix(tip);
    const ready = readyDeposit("33", 1n, 1n, { isReady: true });
    const tooEarly = readyDeposit("34", 2n, readyWindowEnd - 1n, { isReady: false });
    const nearReady = readyDeposit("35", 3n, readyWindowEnd + 1n, {
      isReady: false,
    });
    const future = readyDeposit("36", 4n, readyWindowEnd + 60n * 60n * 1000n, {
      isReady: false,
    });
    const getL1AccountState = vi.fn<IckbSdk["getL1AccountState"]>();
    getL1AccountState.mockResolvedValue({
      system: {
        tip,
        exchangeRatio: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
        orderPool: [],
        feeRate: 1n,
        poolDeposits: {
          deposits: [ready, tooEarly, nearReady, future],
          readyDeposits: [ready],
          id: "pool",
        },
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
    });
    const assertCurrentTip = vi.fn<IckbSdk["assertCurrentTip"]>();
    const findDeposits = vi.fn(async function* (): AsyncGenerator<IckbDepositCell> {
      await Promise.resolve();
      yield* NO_DEPOSITS;
    });
    const runtime = botRuntime({
      sdk: { getL1AccountState, assertCurrentTip },
      managers: { logic: { findDeposits } },
    });

    const state = await readBotState(runtime);

    expect(getL1AccountState).toHaveBeenCalledTimes(1);
    expect(getL1AccountState.mock.calls[0]?.[2]).toMatchObject({
      poolDeposits: { minLockUp: POOL_MIN_LOCK_UP, maxLockUp: POOL_MAX_LOCK_UP },
    });
    expect(findDeposits).not.toHaveBeenCalled();
    expect(assertCurrentTip).not.toHaveBeenCalled();
    expect(state.readyPoolDeposits).toEqual([ready]);
    expect(state.poolDeposits).toEqual([ready, tooEarly, nearReady, future]);
  });
});

describe("readBotState", () => {
  it("excludes own orders from the market and projects account availability", async () => {
    const ownOrder = testOrderGroup("46", 7n);
    const marketOrder = testMatch("47").order;
    const capacityCell = ccc.Cell.from({
      outPoint: { txHash: `0x${"44".repeat(32)}`, index: 0n },
      cellOutput: { capacity: 5n, lock: script("44") },
      outputData: "0x",
    });
    const nativeUdtCell = ccc.Cell.from({
      outPoint: { txHash: `0x${"48".repeat(32)}`, index: 0n },
      cellOutput: { capacity: 0n, lock: script("44") },
      outputData: ccc.numLeToBytes(11n, 16),
    });
    const getL1AccountState = vi.fn<IckbSdk["getL1AccountState"]>();
    getL1AccountState.mockResolvedValue({
      system: {
        tip: headerLike(),
        exchangeRatio: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
        orderPool: [ownOrder.order, marketOrder],
        feeRate: 1n,
        poolDeposits: { deposits: [], readyDeposits: [], id: "pool" },
        ckbAvailable: 0n,
        ckbMaturing: [],
      },
      user: { orders: [ownOrder] },
      account: {
        capacityCells: [capacityCell],
        nativeUdtCells: [nativeUdtCell],
        nativeUdtCapacity: 0n,
        nativeUdtBalance: 11n,
        receipts: [],
        withdrawalGroups: [],
      },
    });

    const state = await readBotState(botRuntime({ sdk: { getL1AccountState } }));

    expect(state.userOrders).toEqual([ownOrder]);
    expect(state.marketOrders).toEqual([marketOrder]);
    expect(state.availableCkbBalance).toBe(
      capacityCell.cellOutput.capacity + ownOrder.ckbValue,
    );
    expect(state.availableIckbBalance).toBe(11n + ownOrder.udtValue);
    expect(state.unavailableCkbBalance).toBe(0n);
    expect(state.totalCkbBalance).toBe(
      state.availableCkbBalance + state.unavailableCkbBalance,
    );
  });

  it("fails closed when L1 account state omits the pool deposit snapshot", async () => {
    const runtime = botRuntime({
      sdk: {
        getL1AccountState: async (): ReturnType<IckbSdk["getL1AccountState"]> => {
          await Promise.resolve();
          return {
            system: {
              tip: headerLike(),
              exchangeRatio: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
              orderPool: [],
              feeRate: 1n,
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
          };
        },
      },
    });

    await expect(readBotState(runtime)).rejects.toThrow(
      "L1 account state is missing pool deposit snapshot",
    );
  });
});

function testOrderGroup(byte: string, ckbValue: bigint): OrderGroup {
  const order = testMatch(byte).order;
  order.cell.cellOutput.capacity = ckbValue;
  return new OrderGroup(
    new MasterCell(
      ccc.Cell.from({
        outPoint: { txHash: `0x${"45".repeat(32)}`, index: 0n },
        cellOutput: { capacity: 0n, lock: script("45") },
        outputData: "0x",
      }),
    ),
    order,
    order,
  );
}
