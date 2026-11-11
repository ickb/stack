import { ccc } from "@ckb-ccc/core";
import { script } from "@ickb/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_COLLECTED_ORDERS,
  MAX_OFFERED_ICKB_CELLS,
  MAX_OFFERED_PLAIN_CELLS,
  MAX_OFFERED_RECEIPTS,
  projectState,
  sumCkb,
  sumUdt,
} from "../../../src/conversion/projection.ts";
import type { AccountState, State } from "../../../src/conversion/types.ts";
import { DAO_HEADER_INDEX_LIMIT } from "../../../src/dao.ts";
import type { OrderGroup } from "../../../src/order/cells.ts";
import {
  CELL_INPUT_SERIALIZED_SIZE,
  EMPTY_WITNESS_SERIALIZATION_SIZE,
} from "../../../src/order/fee.ts";
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
import { state } from "../../transaction/base/support/sdk_core_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const EMPTY_ACCOUNT: AccountState = {
  capacityCells: [],
  nativeUdtCells: [],
  receipts: [],
  withdrawalGroups: [],
};

function project(account: Partial<AccountState>, orders: OrderGroup[] = []): State {
  return projectState(state(), { ...EMPTY_ACCOUNT, ...account }, orders, script("11"));
}

describe("projectState account values", () => {
  it("splits actionable and pending account value", () => {
    const nativeCkb = ccc.fixedPointFrom(50);
    const readyWithdrawal = withdrawalValue({
      ckbValue: 11n,
      udtValue: 13n,
      isReady: true,
      byte: "32",
    });
    const pendingWithdrawal = withdrawalValue({
      ckbValue: 17n,
      udtValue: 19n,
      isReady: false,
      byte: "33",
    });
    const availableOrder = projectionOrderGroup({
      ckbValue: 23n,
      udtValue: 29n,
      isDualRatio: false,
      isMatchable: false,
    });
    // A sell past par: the bot takes it whole, so it stays on the book.
    const pendingOrder = makeOrderGroup({
      ownerLock: script("11"),
      txHashByte: "71",
      ratio: { ckbScale: 2n, udtScale: 1n },
      isCkb2Udt: false,
      udtValue: 10n ** 10n,
    }).group;
    const nativeUdt = nativeUdtCell(7n, { capacity: 5n });

    const projection = project(
      {
        capacityCells: [plainCapacityCell(nativeCkb)],
        nativeUdtCells: [nativeUdt],
        receipts: [receiptValue(41n, 43n)],
        withdrawalGroups: [readyWithdrawal, pendingWithdrawal],
      },
      [availableOrder, pendingOrder],
    );

    expect(projection.readyWithdrawals).toEqual([readyWithdrawal]);
    expect(projection.pendingWithdrawals).toEqual([pendingWithdrawal]);
    expect(projection.availableOrders).toEqual([availableOrder]);
    expect(projection.pendingOrders).toEqual([pendingOrder]);
    const liquidCkb = nativeCkb + nativeUdt.cellOutput.capacity;
    expect(projection.ckbNative).toBe(liquidCkb);
    expect(projection.ickbNative).toBe(7n);
    expect(projection.ckbAvailable).toBe(liquidCkb + 41n + 11n + 23n);
    expect(projection.ickbAvailable).toBe(7n + 43n + 29n);
    // The withdrawal's iCKB is not the account's: only the pending order's counts.
    expect(projection.ckbBalance).toBe(
      projection.ckbAvailable + 17n + pendingOrder.ckbValue,
    );
    expect(projection.ickbBalance).toBe(projection.ickbAvailable + pendingOrder.udtValue);
  });

  it("keeps ready as many matured withdrawals as the deployed script addresses, receipts aside", () => {
    const matured = Array.from({ length: DAO_HEADER_INDEX_LIMIT + 1 }, () =>
      withdrawalValue({ ckbValue: 11n, udtValue: 13n, isReady: true, byte: "32" }),
    );

    const projection = project({
      receipts: [receiptValue(41n, 43n)],
      withdrawalGroups: matured,
    });

    // The withdrawals' deposit headers go first, so the receipt costs no slot; the last
    // withdrawal waits a turn.
    expect(projection.readyWithdrawals).toHaveLength(DAO_HEADER_INDEX_LIMIT);
    expect(projection.pendingWithdrawals).toHaveLength(1);
    expect(projection.ckbAvailable).toBe(41n + 11n * BigInt(DAO_HEADER_INDEX_LIMIT));
    expect(projection.ckbBalance).toBe(41n + 11n * BigInt(matured.length));
  });

  it("derives native iCKB from xUDT cells and counts their capacity as CKB", () => {
    const nativeCkb = ccc.fixedPointFrom(50);
    const nativeUdt = nativeUdtCell(7n, { capacity: 5n });

    const projection = project({
      capacityCells: [plainCapacityCell(nativeCkb)],
      nativeUdtCells: [nativeUdt],
    });

    const liquidCkb = nativeCkb + nativeUdt.cellOutput.capacity;
    expect(projection.ickbNative).toBe(7n);
    expect(projection.ickbAvailable).toBe(7n);
    expect(projection.ckbNative).toBe(liquidCkb);
    expect(projection.ckbAvailable).toBe(liquidCkb);
    expect(projection.ckbBalance).toBe(liquidCkb);
  });

  it("budgets a collectable order whatever its matchability", () => {
    // A matchable buy at par fails the bot's whole-fill rule, so it is collected.
    const matchable = projectionOrderGroup({
      ckbValue: 31n,
      udtValue: 37n,
      isDualRatio: false,
      isMatchable: true,
    });

    const projection = project({}, [matchable]);

    expect(projection.availableOrders).toEqual([matchable]);
    expect(projection.pendingOrders).toEqual([]);
    expect(projection.ckbAvailable).toBe(31n);
    expect(projection.ickbAvailable).toBe(37n);
    expect(projection.ckbBalance).toBe(31n);
    expect(projection.ickbBalance).toBe(37n);
  });

  it("has something to collect from any of its three sources, and nothing from liquid cells", () => {
    const sources: Array<Partial<AccountState>> = [
      { receipts: [receiptValue(41n, 43n)] },
      {
        withdrawalGroups: [
          withdrawalValue({ ckbValue: 11n, udtValue: 13n, isReady: true, byte: "32" }),
        ],
      },
    ];
    for (const account of sources) {
      expect(project(account).hasCollectable).toBe(true);
    }
    const order = projectionOrderGroup({
      ckbValue: 23n,
      udtValue: 29n,
      isDualRatio: false,
      isMatchable: false,
    });
    expect(project({}, [order]).hasCollectable).toBe(true);

    // A pending withdrawal and liquid cells are not collectable: a collection would only
    // compact the account.
    expect(
      project({
        capacityCells: [plainCapacityCell(ccc.fixedPointFrom(50))],
        nativeUdtCells: [nativeUdtCell(7n)],
        withdrawalGroups: [
          withdrawalValue({ ckbValue: 17n, udtValue: 19n, isReady: false, byte: "33" }),
        ],
      }).hasCollectable,
    ).toBe(false);
  });

  it("offers one transaction its share of each kind, largest first, and counts it all", () => {
    const ckb = (index: number): bigint => ccc.fixedPointFrom(index + 1);
    const plain = Array.from({ length: MAX_OFFERED_PLAIN_CELLS + 4 }, (_, index) =>
      plainCapacityCell(ckb(index)),
    );
    const capacity = ccc.fixedPointFrom(143);
    // Three real iCKB cells, then 2,000 empty ones a third party sent the account.
    const ickb = [
      ...[10n, 100n, 50n].map((amount) => nativeUdtCell(amount, { capacity })),
      ...Array.from({ length: 2000 }, () => nativeUdtCell(0n, { capacity })),
    ];
    const receipts = Array.from({ length: MAX_OFFERED_RECEIPTS + 2 }, (_, index) =>
      receiptValue(ckb(index), BigInt(index + 1)),
    );
    const withdrawals = Array.from({ length: DAO_HEADER_INDEX_LIMIT + 2 }, (_, index) =>
      withdrawalValue({ ckbValue: ckb(index), isReady: true, byte: "32" }),
    );
    const orders = Array.from({ length: MAX_COLLECTED_ORDERS + 2 }, (_, index) =>
      projectionOrderGroup({
        ckbValue: ckb(index),
        udtValue: BigInt(index + 1),
        isDualRatio: false,
        isMatchable: false,
      }),
    );
    const account = {
      capacityCells: plain,
      nativeUdtCells: ickb,
      receipts,
      withdrawalGroups: withdrawals,
    };

    const projection = project(account, orders);

    // Each kind's share, the largest first: the smallest of each wait, dust last.
    const offeredPlain = plain.slice(4).toReversed();
    const offeredIckb = projection.cells.slice(MAX_OFFERED_PLAIN_CELLS);
    expect(projection.cells.slice(0, MAX_OFFERED_PLAIN_CELLS)).toEqual(offeredPlain);
    expect(offeredIckb).toHaveLength(MAX_OFFERED_ICKB_CELLS);
    expect(
      offeredIckb.slice(0, 4).map((cell) => ccc.udtBalanceFrom(cell.outputData)),
    ).toEqual([100n, 50n, 10n, 0n]);
    expect(projection.receipts).toEqual(receipts.slice(2).toReversed());
    expect(projection.readyWithdrawals).toEqual(withdrawals.slice(2).toReversed());
    expect(projection.pendingWithdrawals).toEqual(withdrawals.slice(0, 2).toReversed());
    expect(projection.availableOrders).toEqual(orders.slice(2).toReversed());
    expect(projection.pendingOrders).toEqual(orders.slice(0, 2).toReversed());
    // The balances count everything the account owns, offered or not.
    const ckbNative =
      sumCkb(plain.map(({ cellOutput }) => ({ ckbValue: cellOutput.capacity }))) +
      capacity * BigInt(ickb.length);
    expect(projection.ckbNative).toBe(ckbNative);
    expect(projection.ickbNative).toBe(160n);
    expect(projection.ckbAvailable).toBe(
      ckbNative +
        sumCkb(receipts) +
        sumCkb(projection.readyWithdrawals) +
        sumCkb(projection.availableOrders),
    );
    expect(projection.ickbAvailable).toBe(
      160n + sumUdt(receipts) + sumUdt(projection.availableOrders),
    );
    // The Maxes count only the shares: an account holding just them has the same ones.
    const offered = project(
      {
        capacityCells: offeredPlain,
        nativeUdtCells: offeredIckb,
        receipts: projection.receipts,
        withdrawalGroups: projection.readyWithdrawals,
      },
      projection.availableOrders,
    );
    expect(projection.ckbConvertible).toBe(offered.ckbConvertible);
    expect(projection.ickbConvertible).toBe(offered.ickbConvertible);
    expect(projection.ickbConvertible).toBe(
      160n + sumUdt(projection.receipts) + sumUdt(projection.availableOrders),
    );
    expect(projection.ickbConvertible).toBeLessThan(projection.ickbAvailable);
  });

  it("sets aside, from the CKB Max, the fee of each offered input and its header deps", () => {
    // At 1,000 shannons a kB, a byte of fee is a shannon.
    const system = state({ feeRate: 1000n });
    const input = BigInt(CELL_INPUT_SERIALIZED_SIZE + EMPTY_WITNESS_SERIALIZATION_SIZE);
    const header = 32n;
    // Above a plain cell's occupied 61 CKB, which CCC would raise it to.
    const value = ccc.fixedPointFrom(100);
    const max = (account: Partial<AccountState>, orders: OrderGroup[] = []): bigint =>
      projectState(
        system,
        {
          ...EMPTY_ACCOUNT,
          capacityCells: [plainCapacityCell(ccc.fixedPointFrom(1000))],
          ...account,
        },
        orders,
        script("11"),
      ).ckbConvertible;
    const base = max({});

    // The order-only shape's 440 occupied CKB, the 1 CKB margin, and a byte of fee each for
    // the fixed 2,000, the input's 52, the four outputs' 712 and the tip's header dep.
    expect(base).toBe(
      ccc.fixedPointFrom(1000 - 440 - 1) - (2000n + input + 712n + header),
    );

    expect(
      max({
        capacityCells: [
          plainCapacityCell(ccc.fixedPointFrom(1000)),
          plainCapacityCell(value),
        ],
      }),
    ).toBe(base + value - input);
    expect(max({ receipts: [receiptValue(value, 0n)] })).toBe(
      base + value - input - header,
    );
    expect(
      max({
        withdrawalGroups: [
          withdrawalValue({ ckbValue: value, isReady: true, byte: "32" }),
        ],
      }),
    ).toBe(base + value - 2n * (input + header));
    const order = projectionOrderGroup({
      ckbValue: value,
      udtValue: 0n,
      isDualRatio: false,
      isMatchable: false,
    });
    expect(max({}, [order])).toBe(base + value - 2n * input);
  });

  it("collects the most valuable orders first, their iCKB valued at the ratio", () => {
    const order = (ckbValue: bigint, udtValue: bigint): OrderGroup =>
      projectionOrderGroup({
        ckbValue,
        udtValue,
        isDualRatio: false,
        isMatchable: false,
      });
    const mostlyIckb = order(10n, 100n);
    const allCkb = order(50n, 0n);

    expect(project({}, [allCkb, mostlyIckb]).availableOrders).toEqual([
      mostlyIckb,
      allCkb,
    ]);
  });

  it("does not count withdrawal UDT as available or pending iCKB", () => {
    const nativeUdt = nativeUdtCell(7n, { byte: "45" });

    const projection = project({
      nativeUdtCells: [nativeUdt],
      withdrawalGroups: [
        withdrawalValue({ ckbValue: 11n, udtValue: 13n, isReady: true, byte: "34" }),
        withdrawalValue({ ckbValue: 17n, udtValue: 19n, isReady: false, byte: "35" }),
      ],
    });

    expect(projection.ckbAvailable).toBe(nativeUdt.cellOutput.capacity + 11n);
    expect(projection.ckbBalance).toBe(nativeUdt.cellOutput.capacity + 11n + 17n);
    expect(projection.ickbAvailable).toBe(7n);
    expect(projection.ickbBalance).toBe(7n);
  });
});
