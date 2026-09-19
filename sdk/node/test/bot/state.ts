import { ccc } from "@ckb-ccc/core";
import type { IckbDepositCell } from "../../../src/logic.ts";
import { MasterCell, OrderGroup } from "../../../src/order/cells.ts";
import { Ratio } from "../../../src/order/ratio.ts";
import type { IckbSdk } from "../../../src/sdk.ts";

import { headerLike, script } from "@ickb/testkit";
import { describe, expect, it, vi } from "vitest";
import { POOL_MAX_LOCK_UP, POOL_MIN_LOCK_UP } from "../../src/bot/policy.ts";
import { readBotState } from "../../src/bot/state.ts";
import { botRuntime, NO_DEPOSITS, readyDeposit, testMatch } from "./fixtures/bot.ts";

describe("readBotState pool snapshot", () => {
  it("uses the required SDK pool snapshot without storing a readiness copy", async () => {
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
        poolDeposits: [ready, tooEarly, nearReady, future],
      },
      user: { orders: [] },
      account: {
        capacityCells: [],
        nativeUdtCells: [],
        receipts: [],
        withdrawalGroups: [],
      },
    });
    const findDeposits = vi.fn(async (): Promise<IckbDepositCell[]> => {
      await Promise.resolve();
      return NO_DEPOSITS;
    });
    const runtime = botRuntime({
      sdk: { getL1AccountState },
      managers: { ickbLogic: { findDeposits } },
    });

    const state = await readBotState(runtime);

    expect(getL1AccountState).toHaveBeenCalledTimes(1);
    expect(getL1AccountState.mock.calls[0]?.[2]).toMatchObject({
      poolDeposits: { minLockUp: POOL_MIN_LOCK_UP, maxLockUp: POOL_MAX_LOCK_UP },
    });
    expect(findDeposits).not.toHaveBeenCalled();
    expect(state.poolDeposits).toEqual([ready, tooEarly, nearReady, future]);
    expect("readyPoolDeposits" in state).toBe(false);
  });
});

describe("readBotState", () => {
  it("ignores own orders and projects account availability", async () => {
    const ownOrder = await testOrderGroup("46", 7n);
    const marketOrder = (await testMatch("47")).group;
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
        orderPool: [marketOrder],
        feeRate: 1n,
        poolDeposits: [],
      },
      user: { orders: [ownOrder] },
      account: {
        capacityCells: [capacityCell],
        nativeUdtCells: [nativeUdtCell],
        receipts: [],
        withdrawalGroups: [],
      },
    });

    const state = await readBotState(botRuntime({ sdk: { getL1AccountState } }));

    // Own orders do not exist for the bot: not in the market, not in the balances.
    expect(state.marketOrders).toEqual([marketOrder]);
    expect(state.ckb).toBe(
      capacityCell.cellOutput.capacity + nativeUdtCell.cellOutput.capacity,
    );
    expect(state.ickb).toBe(11n);
    expect(state.pendingCkb).toBe(0n);
    expect(state.cells).toEqual([capacityCell, nativeUdtCell]);
  });
});

async function testOrderGroup(byte: string, ckbValue: bigint): Promise<OrderGroup> {
  const order = (await testMatch(byte)).group.order;
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
