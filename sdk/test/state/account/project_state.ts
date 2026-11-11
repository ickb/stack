import { ccc } from "@ckb-ccc/core";
import { script } from "@ickb/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildBaseTransaction } from "../../../src/build.ts";
import { projectState } from "../../../src/conversion/projection.ts";
import type { OrderGroup } from "../../../src/order/cells.ts";
import {
  makeOrderGroup,
  projectionOrderGroup,
} from "../../conversion/planning/support/sdk_order_support.ts";
import {
  nativeUdtCell,
  plainCapacityCell,
  receiptValue,
  withdrawalValue,
} from "../../conversion/withdrawal_quotes/support/sdk_cell_support.ts";
import { headerLike, state } from "../../transaction/base/support/sdk_core_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("projectState", () => {
  it("collects at most 128 orders in one transaction, the rest the next", () => {
    // 383 orders exhaust the deployed order script's heap in one transaction; anyone can
    // mint groups whose master carries the user's lock, so an uncapped set would stall.
    const orders = Array.from({ length: 383 }, () =>
      projectionOrderGroup({
        ckbValue: 11n,
        udtValue: 13n,
        isDualRatio: false,
        isMatchable: false,
      }),
    );
    const account = {
      capacityCells: [],
      nativeUdtCells: [],
      receipts: [],
      withdrawalGroups: [],
    };

    const projected = projectState(state(), account, orders, script("11"));

    expect(projected.availableOrders).toHaveLength(128);
    expect(projected.pendingOrders).toHaveLength(255);
    // The scan order stays: the first 128 are collected now.
    expect(projected.availableOrders).toEqual(orders.slice(0, 128));
    expect(projected.pendingOrders).toEqual(orders.slice(128));
    // Orders past the cap are pending value, not spendable now.
    expect(projected.ckbAvailable).toBe(11n * 128n);
    expect(projected.ickbAvailable).toBe(13n * 128n);
    expect(projected.ckbBalance).toBe(11n * 383n);
    // Each melted order spends its order cell and its master.
    const tx = buildBaseTransaction(ccc.Transaction.default(), projected);
    expect(tx.inputs).toHaveLength(2 * 128);
  });

  it("projects one flat state from the system, the account and the orders to collect", () => {
    const nativeCkb = ccc.fixedPointFrom(50);
    const readyWithdrawal = withdrawalValue({
      ckbValue: 11n,
      udtValue: 0n,
      isReady: true,
      byte: "36",
    });
    const pendingWithdrawal = withdrawalValue({
      ckbValue: 17n,
      udtValue: 0n,
      isReady: false,
      maturityUnix: 5000n,
      byte: "37",
    });
    const matchable = projectionOrderGroup({
      ckbValue: 31n,
      udtValue: 37n,
      isDualRatio: false,
      isMatchable: true,
    });
    Object.defineProperty(matchable.order, "maturity", { value: 7000n });
    const receipt = receiptValue(41n, 43n);
    const nativeUdt = nativeUdtCell(7n, { byte: "46" });
    const account = {
      capacityCells: [plainCapacityCell(nativeCkb)],
      nativeUdtCells: [nativeUdt],
      receipts: [receipt],
      withdrawalGroups: [readyWithdrawal, pendingWithdrawal],
    };
    const currentSystem = state({ tip: headerLike(0n, { timestamp: 1000n }) });

    const projected = projectState(currentSystem, account, [matchable], script("11"));

    // A buy at par fails the bot's whole-fill rule, so it is collected.
    const liquidCkb = nativeCkb + nativeUdt.cellOutput.capacity;
    expect(projected).toEqual({
      tip: currentSystem.tip,
      feeRate: currentSystem.feeRate,
      exchangeRatio: currentSystem.exchangeRatio,
      depositCapacity: currentSystem.depositCapacity,
      orderBook: currentSystem.orderBook,
      poolDeposits: currentSystem.poolDeposits,
      lockUp: currentSystem.lockUp,
      changeLock: script("11"),
      cells: [...account.capacityCells, nativeUdt],
      receipts: [receipt],
      readyWithdrawals: [readyWithdrawal],
      pendingWithdrawals: [pendingWithdrawal],
      availableOrders: [matchable],
      pendingOrders: [],
      hasCollectable: true,
      ckbNative: liquidCkb,
      ickbNative: 7n,
      ckbAvailable: liquidCkb + 41n + 11n + 31n,
      ickbAvailable: 7n + 43n + 37n,
      ckbConvertible: projected.ckbConvertible,
      ckbBalance: liquidCkb + 41n + 11n + 31n + 17n,
      ickbBalance: 7n + 43n + 37n,
      estimatedMaturity: 5000n,
    });
  });

  it("keeps a sell the bot fills pending, dated, and collects one it refuses", () => {
    const sell = (
      byte: string,
      ratio: { ckbScale: bigint; udtScale: bigint },
    ): OrderGroup =>
      makeOrderGroup({
        ownerLock: script("11"),
        txHashByte: byte,
        ratio,
        isCkb2Udt: false,
        udtValue: 10n ** 10n,
      }).group;
    // Priced past par the bot takes it whole; at half par it never does.
    const matchable = sell("71", { ckbScale: 2n, udtScale: 1n });
    const refused = sell("72", { ckbScale: 1n, udtScale: 2n });
    const projected = projectState(
      state({ tip: headerLike(0n, { timestamp: 1000n }) }),
      {
        capacityCells: [],
        nativeUdtCells: [],
        receipts: [],
        withdrawalGroups: [],
      },
      [matchable, refused],
      script("11"),
    );

    // Working capital covers it on an empty book: ten minutes from the tip.
    expect(projected.availableOrders).toEqual([refused]);
    expect(projected.estimatedMaturity).toBe(1000n + 600_000n);
  });
});
