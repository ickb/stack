import type { ccc } from "@ckb-ccc/ccc";
import { Ratio } from "@ickb/order";
import { headerLike } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import { buildStateId, walletLocksKey } from "../../src/query/queryStateId.ts";
import { cell, script } from "./fixtures/query.ts";

describe("walletLocksKey", () => {
  it("deduplicates and sorts account locks", () => {
    const primaryLock = script("11");
    const first = script("22");
    const second = script("33");

    expect(walletLocksKey({ primaryLock, accountLocks: [second, first, second] })).toBe(
      `primary=${primaryLock.toHex()};accounts=${first.toHex()},${second.toHex()}`,
    );
  });
});

describe("buildStateId", () => {
  it("keys collectable, pending, and fallback outpoint state", () => {
    const primaryLock = script("11");
    const context = baseContext({
      system: {
        ...baseContext().system,
        orderPool: [orderState(1n, 2n)],
        poolDeposits: { id: "pool-a" },
      },
      capacityCells: [cellWithOutPoint(undefined)],
      nativeUdtCells: [cellWithOutPoint({ txHash: "0xabc", index: 2n })],
      receipts: [valueWithCell(3n, 4n, undefined)],
      readyWithdrawals: [withdrawalState(5n, 6n)],
      availableOrders: [orderState(7n, 8n)],
    });
    const stateId = buildStateId(
      { chain: "testnet", primaryLock, accountLocks: [primaryLock] },
      context,
      [withdrawalState(9n, 10n)],
      [orderState(11n, 12n)],
    );

    expect(stateId).toContain("deposits=pool-a");
    expect(stateId).toContain("capacityCells=missing-outpoint");
    expect(stateId).toContain("nativeUdtCells=0xabc#2");
    expect(stateId).toContain("receipts=3/4@missing-outpoint");
    expect(stateId).toContain("readyWithdrawals=5/6@missing-outpoint@0xabc#2");
    expect(stateId).toContain(
      "availableOrders=7/8@missing-outpoint@0xabc#2@invalid-outpoint.txHash#missing-outpoint.index",
    );
    expect(stateId).toContain("pendingWithdrawals=9/10@missing-outpoint@0xabc#2");
    expect(stateId).toContain(
      "pendingOrders=11/12@missing-outpoint@0xabc#2@invalid-outpoint.txHash#missing-outpoint.index",
    );
  });
});

function baseContext(
  overrides: Partial<Parameters<typeof buildStateId>[1]> = {},
): Parameters<typeof buildStateId>[1] {
  return {
    system: {
      feeRate: 1n,
      tip: headerLike({ timestamp: 0n }),
      exchangeRatio: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
      orderPool: [],
      poolDeposits: { id: "" },
      ckbAvailable: 0n,
      ckbMaturing: [],
    },
    capacityCells: [],
    nativeUdtCells: [],
    receipts: [],
    readyWithdrawals: [],
    availableOrders: [],
    ckbAvailable: 0n,
    ickbAvailable: 0n,
    estimatedMaturity: 0n,
    ...overrides,
  };
}

function valueWithCell(
  ckbValue: bigint,
  udtValue: bigint,
  entryCell: ccc.Cell | undefined,
): { ckbValue: bigint; udtValue: bigint; cell?: ccc.Cell } {
  return entryCell === undefined
    ? { ckbValue, udtValue }
    : { ckbValue, udtValue, cell: entryCell };
}

function withdrawalState(
  ckbValue: bigint,
  udtValue: bigint,
): {
  ckbValue: bigint;
  udtValue: bigint;
  owned: { cell: ccc.Cell };
  owner: { cell: ccc.Cell };
} {
  return {
    ckbValue,
    udtValue,
    owned: { cell: cellWithOutPoint(undefined) },
    owner: { cell: cellWithOutPoint({ txHash: "0xabc", index: 2n }) },
  };
}

function orderState(
  ckbValue: bigint,
  udtValue: bigint,
): {
  ckbValue: bigint;
  udtValue: bigint;
  order: { cell: ccc.Cell };
  master: { cell: ccc.Cell };
  origin: { cell: ccc.Cell };
} {
  return {
    ckbValue,
    udtValue,
    order: { cell: cellWithOutPoint(undefined) },
    master: { cell: cellWithOutPoint({ txHash: "0xabc", index: 2n }) },
    origin: { cell: cellWithOutPoint({ txHash: {}, index: undefined }) },
  };
}

function cellWithOutPoint(outPoint: unknown): ccc.Cell {
  const testCell = cell(1n, script("44"));
  Object.defineProperty(testCell, "outPoint", {
    configurable: true,
    value: outPoint,
  });
  return testCell;
}
