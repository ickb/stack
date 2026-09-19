import { ccc } from "@ckb-ccc/core";
import { script } from "@ickb/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { projectConversionTransactionContext } from "../../../src/conversion/projection.ts";
import type { SystemState } from "../../../src/conversion/types.ts";
import { projectionOrderGroup } from "../../conversion/planning/support/sdk_order_support.ts";
import {
  nativeUdtCell,
  receiptValue,
  withdrawalValue,
} from "../../conversion/withdrawal_quotes/support/sdk_cell_support.ts";
import {
  baseTip,
  hash,
  headerLike,
  ratio,
} from "../../transaction/base/support/sdk_core_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

function plainCapacityCell(capacity: bigint, lock = script("11"), byte = "10"): ccc.Cell {
  return ccc.Cell.from({
    outPoint: { txHash: hash(byte), index: 0n },
    cellOutput: { capacity, lock },
    outputData: "0x",
  });
}

function system(overrides: Partial<SystemState> = {}): SystemState {
  return {
    feeRate: 1n,
    tip: baseTip,
    exchangeRatio: ratio,
    orderPool: [],
    poolDeposits: [],
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
      { available: [matchable], pending: [] },
    );

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

  it("includes pending order maturity", () => {
    const matchable = projectionOrderGroup({
      ckbValue: 31n,
      udtValue: 37n,
      isDualRatio: false,
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
      { available: [], pending: [matchable] },
    );

    // A CKB-to-iCKB order on an empty book: ten minutes from the tip.
    expect(context.estimatedMaturity).toBe(1000n + 600_000n);
  });
});
