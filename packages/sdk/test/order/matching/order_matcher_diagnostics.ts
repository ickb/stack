import { ccc } from "@ckb-ccc/core";
import { byte32FromByte, StubClient } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import { OrderMatcher } from "../../../src/order/matching/order_matcher.ts";
import { OrderCell, OrderGroup } from "../../../src/order/model/cells.ts";
import { Info } from "../../../src/order/model/info.ts";
import { OrderManager } from "../../../src/order/order.ts";
import { ORDER_MATCHER_SUITE } from "../fixtures/order_constants.ts";
import {
  exhaustiveIntegerBestMatch,
  makeUdtToCkbOrder,
  matchKey,
  resolvedOrderGroup,
  resolvedOrderGroups,
} from "./support/order_match_helpers.ts";
import { dualInfo, makeOrderCell } from "./support/order_order_helpers.ts";
describe(ORDER_MATCHER_SUITE, () => {
  it("charges one mining fee unit per selected partial", () => {
    const order = makeUdtToCkbOrder({ udtValue: 100n });

    const { match } = OrderManager.bestMatch(
      [resolvedOrderGroup(order)],
      {
        ckbValue: 400n,
        udtValue: 0n,
      },
      {
        ckbScale: 1n,
        udtScale: 100n,
      },
      {
        feeRate: 1000n,
        ckbAllowanceStep: ccc.fixedPointFrom(1),
      },
    );

    expect(match.partials).toHaveLength(1);
    expect(match.ckbDelta).toBe(-40n);
  });

  it("ignores matches whose estimated mining fee exceeds the value gain", () => {
    const order = makeUdtToCkbOrder({ udtValue: 100n });

    const { match } = OrderManager.bestMatch(
      [resolvedOrderGroup(order)],
      {
        ckbValue: 1000n,
        udtValue: 0n,
      },
      {
        ckbScale: 3n,
        udtScale: 5n,
      },
      {
        feeRate: 1000n,
        ckbAllowanceStep: ccc.fixedPointFrom(1),
      },
    );

    expect(match).toMatchObject({
      ckbDelta: 0n,
      udtDelta: 0n,
      partials: [],
      diagnostics: {
        orderCount: 1,
        directions: {
          ckbToUdt: { matchableCount: 0 },
          udtToCkb: { matchableCount: 1 },
        },
        candidates: {
          bestGain: 0n,
          positiveGain: 0,
        },
      },
    });
    expect(match.diagnostics?.candidates.rejected.nonPositiveGain).toBeGreaterThan(0);
  });
});

describe(ORDER_MATCHER_SUITE, () => {
  it("does not select non-positive candidates after rejecting the empty allowance", () => {
    const order = makeOrderCell({
      ckbUnoccupied: 200n,
      udtValue: 0n,
      info: Info.create(true, { ckbScale: 1n, udtScale: 1n }),
      master: {
        type: "absolute",
        value: {
          txHash: byte32FromByte("33"),
          index: 1n,
        },
      },
      outPoint: {
        txHash: byte32FromByte("55"),
        index: 0n,
      },
    });

    const { match } = OrderManager.bestMatch(
      [resolvedOrderGroup(order)],
      {
        ckbValue: -1n,
        udtValue: 1000n,
      },
      {
        ckbScale: 1n,
        udtScale: 1n,
      },
      {
        feeRate: 0n,
        ckbAllowanceStep: ccc.fixedPointFrom(1),
      },
    );

    expect(match).toMatchObject({
      ckbDelta: 0n,
      udtDelta: 0n,
      partials: [],
      diagnostics: {
        candidates: {
          bestGain: 0n,
          positiveGain: 0,
        },
      },
    });
    expect(
      match.diagnostics?.candidates.rejected.insufficientCkbAllowance,
    ).toBeGreaterThan(0);
    expect(match.diagnostics?.candidates.rejected.nonPositiveGain).toBeGreaterThan(0);
  });
});

describe(ORDER_MATCHER_SUITE, () => {
  it("reports one primary allowance rejection reason per candidate", () => {
    const order = makeUdtToCkbOrder();

    const { match } = OrderManager.bestMatch(
      [resolvedOrderGroup(order)],
      {
        ckbValue: -ccc.fixedPointFrom(1000),
        udtValue: -ccc.fixedPointFrom(1000),
      },
      {
        ckbScale: 3n,
        udtScale: 5n,
      },
      {
        feeRate: 0n,
        ckbAllowanceStep: ccc.fixedPointFrom(1),
      },
    );

    const rejected = match.diagnostics?.candidates.rejected;
    expect(rejected?.insufficientCkbAllowance).toBeGreaterThan(0);
    expect(rejected?.insufficientUdtAllowance).toBe(0);
  });
});

describe(ORDER_MATCHER_SUITE, () => {
  it("does not use the same order cell in both match directions", () => {
    const order = makeOrderCell({
      ckbUnoccupied: 100n,
      udtValue: 50n,
      info: dualInfo(),
      master: {
        type: "absolute",
        value: {
          txHash: byte32FromByte("33"),
          index: 1n,
        },
      },
      outPoint: {
        txHash: byte32FromByte("44"),
        index: 0n,
      },
    });

    const { match } = OrderManager.bestMatch(
      [resolvedOrderGroup(order)],
      {
        ckbValue: 50n,
        udtValue: 50n,
      },
      {
        ckbScale: 2n,
        udtScale: 1n,
      },
      {
        feeRate: 0n,
        ckbAllowanceStep: ccc.fixedPointFrom(1),
      },
    );

    expect(
      match.partials.map((partial) => partial.group.order.cell.outPoint.toHex()),
    ).toEqual([order.cell.outPoint.toHex()]);
  });
});

describe(ORDER_MATCHER_SUITE, () => {
  it("rejects invalid best-match search parameters", () => {
    const order = makeUdtToCkbOrder();
    const group = resolvedOrderGroup(order);
    const allowance = { ckbValue: 50n, udtValue: 50n };

    expect(() =>
      OrderManager.bestMatch(
        [],
        allowance,
        { ckbScale: 0n, udtScale: 1n },
        { ckbAllowanceStep: ccc.fixedPointFrom(1) },
      ),
    ).toThrow("Exchange rate scales must be positive");
    expect(() =>
      OrderManager.bestMatch(
        [],
        allowance,
        { ckbScale: 1n, udtScale: 0n },
        { ckbAllowanceStep: ccc.fixedPointFrom(1) },
      ),
    ).toThrow("Exchange rate scales must be positive");
    expect(() =>
      OrderManager.bestMatch(
        [],
        allowance,
        { ckbScale: 1n, udtScale: 1n },
        { ckbAllowanceStep: 0n },
      ),
    ).toThrow("CKB allowance step must be positive");
    expect(() =>
      OrderManager.bestMatch([group], allowance, { ckbScale: 1n, udtScale: 1n }),
    ).not.toThrow();
    expect(() =>
      OrderManager.bestMatch(
        [],
        allowance,
        { ckbScale: 1n, udtScale: 1n },
        { feeRate: -1n },
      ),
    ).toThrow("Fee rate must be non-negative");
  });

  it("rejects unresolved order inputs", () => {
    const order = makeUdtToCkbOrder();
    const resolved = resolvedOrderGroup(order);
    const allowance = { ckbValue: 1n, udtValue: 1n };
    const exchangeRate = { ckbScale: 1n, udtScale: 1n };

    expect(() =>
      OrderManager.bestMatch(
        [new OrderGroup(resolved.master, order, order)],
        allowance,
        exchangeRate,
      ),
    ).toThrow("OrderGroup does not match its resolver attestation");
  });

  it("rejects a structurally valid group that was never resolver-produced", () => {
    const order = makeUdtToCkbOrder();
    const resolved = resolvedOrderGroup(order);
    const unattestedOrder = OrderCell.mustFrom(
      ccc.Cell.from({
        outPoint: order.cell.outPoint,
        cellOutput: order.cell.cellOutput,
        outputData: order.cell.outputData,
      }),
    );
    const unattested = new OrderGroup(resolved.master, unattestedOrder, resolved.origin);

    expect(() =>
      OrderManager.bestMatch(
        [unattested],
        { ckbValue: 1n, udtValue: 1n },
        { ckbScale: 1n, udtScale: 1n },
      ),
    ).toThrow("OrderGroup was not produced by the order resolver");
  });
});

describe(ORDER_MATCHER_SUITE, () => {
  it("allows negative allowances for a valid empty-pool match", () => {
    expect(
      OrderManager.bestMatch(
        [],
        { ckbValue: -1n, udtValue: -1n },
        { ckbScale: 1n, udtScale: 1n },
      ),
    ).toEqual({
      kind: "complete",
      match: { ckbDelta: 0n, udtDelta: 0n, partials: [] },
    });
  });
});

describe(ORDER_MATCHER_SUITE, () => {
  it("preserves resolver provenance through maturity-only projections", () => {
    const group = resolvedOrderGroup(makeUdtToCkbOrder({ udtValue: 100n }));
    const { order } = group;
    const projected = new OrderGroup(
      group.master,
      new OrderCell({
        cell: order.cell,
        data: order.data,
        ckbUnoccupied: order.ckbUnoccupied,
        absTotal: order.absTotal,
        absProgress: order.absProgress,
        maturity: 123n,
      }),
      group.origin,
    );

    expect(() =>
      OrderManager.bestMatch(
        [projected],
        { ckbValue: 1000n, udtValue: 0n },
        { ckbScale: 3n, udtScale: 5n },
        { feeRate: 0n, ckbAllowanceStep: ccc.fixedPointFrom(1) },
      ),
    ).not.toThrow();
  });
});

describe(ORDER_MATCHER_SUITE, () => {
  it("uses prepared marginal size for first, later, and variable-args partials", async () => {
    const smallOrder = makeUdtToCkbOrder({
      txHashByte: "40",
      orderTxHashByte: "50",
      udtValue: 100n,
    });
    const largeOrder = makeUdtToCkbOrder({
      txHashByte: "41",
      orderTxHashByte: "51",
      lockArgs: `0x${"00".repeat(100)}`,
      udtValue: 100n,
    });
    const allowance = {
      ckbValue: ccc.fixedPointFrom(1000),
      udtValue: 0n,
    };
    const exchangeRate = { ckbScale: 3n, udtScale: 5n };
    const options = {
      feeRate: 1000n,
      ckbAllowanceStep: ccc.fixedPointFrom(1),
    };

    expect(largeOrder.cell.occupiedSize).toBeGreaterThan(smallOrder.cell.occupiedSize);
    expect(smallOrder.cell.occupiedSize).toBe(163);
    expect(partialMarginalSizes(smallOrder.cell)).toEqual([275, 275]);
    expect(partialMarginalSizes(largeOrder.cell)).toEqual([375, 375]);
    await expect(preparedPartialMarginalSizes(smallOrder.cell)).resolves.toEqual([
      283, 283,
    ]);
    await expect(preparedPartialMarginalSizes(largeOrder.cell)).resolves.toEqual([
      383, 383,
    ]);
    const groups = resolvedOrderGroups([smallOrder, largeOrder]);
    const { match } = OrderManager.bestMatch(groups, allowance, exchangeRate, options);

    expect(match.diagnostics?.ckbMiningFee).toBe(383n);
    expect(matchKey(match)).toEqual(
      matchKey(exhaustiveIntegerBestMatch(groups, allowance, exchangeRate, options)),
    );
  });
});

describe(ORDER_MATCHER_SUITE, () => {
  it("rejects a partial whose old fee model hid a real economic loss", () => {
    const order = makeOrderCell({
      ckbUnoccupied: 300n,
      udtValue: 0n,
      info: Info.create(true, { ckbScale: 89n, udtScale: 300n }, 0),
      master: {
        type: "absolute",
        value: { txHash: byte32FromByte("42"), index: 1n },
      },
      outPoint: { txHash: byte32FromByte("52"), index: 0n },
    });
    const group = resolvedOrderGroup(order);
    const realFee = 275n;
    const matcher = OrderMatcher.from(group, true, realFee);
    if (matcher === undefined) {
      throw new Error("Expected economic regression order to be matchable");
    }
    const full = matcher.match(matcher.bMaxMatch);
    const grossGain = full.ckbDelta + full.udtDelta;
    const oldModeledFee = 36n + BigInt(order.cell.occupiedSize);

    expect(grossGain).toBe(211n);
    expect(grossGain - oldModeledFee).toBe(12n);
    expect(grossGain - realFee).toBe(-64n);
    expect(
      OrderManager.bestMatch(
        [group],
        { ckbValue: 0n, udtValue: matcher.bMaxMatch },
        { ckbScale: 1n, udtScale: 1n },
        { feeRate: 1000n, ckbAllowanceStep: 61n },
      ).match.partials,
    ).toEqual([]);
  });

  it("rejects a prepared partial whose raw size hid a four-shannon loss", () => {
    const order = makeOrderCell({
      ckbUnoccupied: 300n,
      udtValue: 0n,
      info: Info.create(true, { ckbScale: 21n, udtScale: 300n }, 0),
      master: {
        type: "absolute",
        value: { txHash: byte32FromByte("43"), index: 1n },
      },
      outPoint: { txHash: byte32FromByte("53"), index: 0n },
    });
    const group = resolvedOrderGroup(order);
    const preparedFee = 283n;
    const matcher = OrderMatcher.from(group, true, preparedFee);
    if (matcher === undefined) {
      throw new Error("Expected prepared-fee regression order to be matchable");
    }
    const full = matcher.match(matcher.bMaxMatch);
    const grossGain = full.ckbDelta + full.udtDelta;

    expect(grossGain).toBe(279n);
    expect(grossGain - 275n).toBe(4n);
    expect(grossGain - preparedFee).toBe(-4n);
    expect(
      OrderManager.bestMatch(
        [group],
        { ckbValue: 0n, udtValue: matcher.bMaxMatch },
        { ckbScale: 1n, udtScale: 1n },
        { feeRate: 1000n, ckbAllowanceStep: 61n },
      ).match.partials,
    ).toEqual([]);
  });
});

function partialMarginalSizes(cell: ccc.Cell): [number, number] {
  const tx = ccc.Transaction.default();
  const emptySize = tx.toBytes().length;
  appendPartial(tx, cell);
  const firstSize = tx.toBytes().length;
  appendPartial(tx, cell);
  const secondSize = tx.toBytes().length;
  return [firstSize - emptySize, secondSize - firstSize];
}

function appendPartial(tx: ccc.Transaction, cell: ccc.Cell): void {
  tx.addInput(cell);
  tx.addOutput(cell.cellOutput, cell.outputData);
}

async function preparedPartialMarginalSizes(cell: ccc.Cell): Promise<[number, number]> {
  const emptySize = await preparedTransactionSize([]);
  const firstSize = await preparedTransactionSize([cell]);
  const secondSize = await preparedTransactionSize([cell, cell]);
  return [firstSize - emptySize, secondSize - firstSize];
}

async function preparedTransactionSize(partials: ccc.Cell[]): Promise<number> {
  const tx = ccc.Transaction.default();
  for (const partial of partials) {
    appendPartial(tx, partial);
  }
  const signerLock = ccc.Script.from({
    codeHash: byte32FromByte("98"),
    hashType: "type",
    args: "0x",
  });
  tx.addInput(
    ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("99"), index: 0n },
      cellOutput: {
        capacity: ccc.fixedPointFrom(100),
        lock: signerLock,
      },
      outputData: "0x",
    }),
  );
  await tx.prepareSighashAllWitness(signerLock, 65, new StubClient());
  return tx.toBytes().length;
}
