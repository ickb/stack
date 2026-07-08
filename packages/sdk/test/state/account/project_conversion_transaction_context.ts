import { ccc } from "@ckb-ccc/core";
import { script } from "@ickb/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  projectConversionTransactionContext,
  type SystemState,
} from "../../../src/sdk.ts";
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
    ckbAvailable: 0n,
    ckbMaturing: [],
    ...overrides,
  };
}

describe("projectConversionTransactionContext", () => {
  it("projects conversion context from account state and collected-order policy", () => {
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
      nativeUdtCapacity: nativeUdt.cellOutput.capacity,
      nativeUdtBalance: 7n,
      receipts: [receipt],
      withdrawalGroups: [readyWithdrawal, pendingWithdrawal],
    };
    const currentSystem = system({ tip: headerLike(0n, { timestamp: 1000n }) });

    const { projection, context } = projectConversionTransactionContext(
      currentSystem,
      account,
      [matchable],
      {
        collectedOrdersAvailable: true,
      },
    );

    expect(projection.availableOrders).toEqual([matchable]);
    expect(context).toEqual({
      system: currentSystem,
      receipts: [receipt],
      readyWithdrawals: [readyWithdrawal],
      availableOrders: [matchable],
      ckbAvailable: projection.ckbAvailable,
      ickbAvailable: projection.ickbAvailable,
      estimatedMaturity: 5000n,
    });
  });

  it("includes pending order maturity when collected orders are not budgeted", () => {
    const matchable = projectionOrderGroup({
      ckbValue: 31n,
      udtValue: 37n,
      isDualRatio: false,
      isMatchable: true,
    });
    Object.defineProperty(matchable.order, "maturity", { value: 7000n });

    const { context } = projectConversionTransactionContext(
      system({ tip: headerLike(0n, { timestamp: 1000n }) }),
      {
        capacityCells: [],
        nativeUdtCells: [],
        nativeUdtCapacity: 0n,
        nativeUdtBalance: 0n,
        receipts: [],
        withdrawalGroups: [],
      },
      [matchable],
    );

    expect(context.estimatedMaturity).toBe(7000n);
  });
});
