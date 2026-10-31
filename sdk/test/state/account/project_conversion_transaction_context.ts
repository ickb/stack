import { ccc } from "@ckb-ccc/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { projectConversionTransactionContext } from "../../../src/conversion/projection.ts";
import type { SystemState } from "../../../src/conversion/types.ts";
import { WALLET_LOCK_UP } from "../../../src/dao.ts";
import { projectionOrderGroup } from "../../conversion/planning/support/sdk_order_support.ts";
import {
  nativeUdtCell,
  plainCapacityCell,
  receiptValue,
  withdrawalValue,
} from "../../conversion/withdrawal_quotes/support/sdk_cell_support.ts";
import {
  baseTip,
  headerLike,
  ratio,
} from "../../transaction/base/support/sdk_core_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

function system(overrides: Partial<SystemState> = {}): SystemState {
  return {
    feeRate: 1n,
    tip: baseTip,
    exchangeRatio: ratio,
    orderPool: [],
    poolDeposits: [],
    lockUp: WALLET_LOCK_UP,
    ...overrides,
  };
}

describe("projectConversionTransactionContext", () => {
  it("projects conversion context from account state and the orders to collect", () => {
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
    const currentSystem = system({ tip: headerLike(0n, { timestamp: 1000n }) });

    const { projection, context } = projectConversionTransactionContext(
      currentSystem,
      account,
      [matchable],
    );

    // A buy at par fails the bot's whole-fill rule, so it is collected.
    expect(projection.availableOrders).toEqual([matchable]);
    expect(context).toEqual({
      system: currentSystem,
      receipts: [receipt],
      readyWithdrawals: [readyWithdrawal],
      availableOrders: [matchable],
      cells: [...account.capacityCells, nativeUdt],
      ckbAvailable: projection.ckbAvailable,
      ickbAvailable: projection.ickbAvailable,
      estimatedMaturity: 5000n,
    });
  });

  it("keeps a live sell pending and includes its maturity", () => {
    // The fixture's dual-ratio flag builds the iCKB-to-CKB direction alone: a sell, which
    // waits for the age cutoff rather than being collected.
    const matchable = projectionOrderGroup({
      ckbValue: 31n,
      udtValue: 37n,
      isDualRatio: true,
      isMatchable: true,
    });
    const { context } = projectConversionTransactionContext(
      system({ tip: headerLike(0n, { timestamp: 1000n }) }),
      {
        capacityCells: [],
        nativeUdtCells: [],
        receipts: [],
        withdrawalGroups: [],
      },
      [matchable],
    );

    // Working capital covers it on an empty book: ten minutes from the tip.
    expect(context.availableOrders).toEqual([]);
    expect(context.estimatedMaturity).toBe(1000n + 600_000n);
  });
});
