import { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import { Info } from "../../../src/order/model/info.ts";
import { OrderManager } from "../../../src/order/order.ts";
import { ORDER_MATCHER_SUITE } from "../fixtures/order_constants.ts";
import {
  exhaustiveIntegerBestMatch,
  makeUdtToCkbOrder,
  matchKey,
  resolvedOrderGroups,
} from "./support/order_match_helpers.ts";
import { byte32FromByte, makeOrderCell } from "./support/order_order_helpers.ts";
describe(ORDER_MATCHER_SUITE, () => {
  it.each([
    {
      name: "CKB-to-UDT positive endpoint",
      isCkb2Udt: true,
      ratio: { ckbScale: 1n, udtScale: 2n },
      exchangeRate: { ckbScale: 2n, udtScale: 3n },
      allowance: { ckbValue: 0n, udtValue: 3n },
      expected: { ckbDelta: 4n, udtDelta: -2n },
    },
    {
      name: "CKB-to-UDT non-positive endpoint",
      isCkb2Udt: true,
      ratio: { ckbScale: 1n, udtScale: 2n },
      exchangeRate: { ckbScale: 3n, udtScale: 5n },
      allowance: { ckbValue: 0n, udtValue: 3n },
      expected: { ckbDelta: 4n, udtDelta: -2n },
    },
    {
      name: "UDT-to-CKB positive endpoint",
      isCkb2Udt: false,
      ratio: { ckbScale: 2n, udtScale: 1n },
      exchangeRate: { ckbScale: 3n, udtScale: 2n },
      allowance: { ckbValue: 3n, udtValue: 0n },
      expected: { ckbDelta: -2n, udtDelta: 4n },
    },
    {
      name: "UDT-to-CKB non-positive endpoint",
      isCkb2Udt: false,
      ratio: { ckbScale: 2n, udtScale: 1n },
      exchangeRate: { ckbScale: 5n, udtScale: 3n },
      allowance: { ckbValue: 3n, udtValue: 0n },
      expected: { ckbDelta: -2n, udtDelta: 4n },
    },
  ])("finds the exact singleton optimum for $name", (fixture) => {
    const order = makeOrderCell({
      ckbUnoccupied: fixture.isCkb2Udt ? 5n : 0n,
      udtValue: fixture.isCkb2Udt ? 0n : 5n,
      info: Info.create(fixture.isCkb2Udt, fixture.ratio, 0),
      master: {
        type: "absolute",
        value: { txHash: byte32FromByte("30"), index: 1n },
      },
      outPoint: { txHash: byte32FromByte("31"), index: 0n },
    });
    const groups = resolvedOrderGroups([order]);
    const options = { feeRate: 0n, ckbAllowanceStep: 1n, maxPartials: 1 };

    const result = OrderManager.bestMatch(
      groups,
      fixture.allowance,
      fixture.exchangeRate,
      options,
    );

    expect(result.kind).toBe("complete");
    expect(result.match).toMatchObject(fixture.expected);
    expect(matchKey(result.match)).toEqual(
      matchKey(
        exhaustiveIntegerBestMatch(
          groups,
          fixture.allowance,
          fixture.exchangeRate,
          options,
        ),
      ),
    );
  });
});

describe(ORDER_MATCHER_SUITE, () => {
  it("caps singleton CKB spend at reachable allowance after the prepared fee", () => {
    const initialCkb = 300n;
    const { match } = OrderManager.bestMatch(
      resolvedOrderGroups([makeUdtToCkbOrder()]),
      { ckbValue: initialCkb, udtValue: 0n },
      { ckbScale: 1n, udtScale: 100n },
      { feeRate: 1000n, ckbAllowanceStep: 1n, maxPartials: 1 },
    );

    expect(match.partials).toHaveLength(1);
    expect(-match.ckbDelta + (match.diagnostics?.ckbMiningFee ?? 0n)).toBeLessThanOrEqual(
      initialCkb,
    );
  });

  it("respects a partial cap when selecting the best match", () => {
    const orders = [
      makeUdtToCkbOrder({
        txHashByte: "10",
        orderTxHashByte: "20",
        udtValue: 100n,
      }),
      makeUdtToCkbOrder({
        txHashByte: "11",
        orderTxHashByte: "21",
        udtValue: 100n,
      }),
    ];
    const groups = resolvedOrderGroups(orders);

    const uncapped = OrderManager.bestMatch(
      groups,
      {
        ckbValue: ccc.fixedPointFrom(1000),
        udtValue: 0n,
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
    const capped = OrderManager.bestMatch(
      groups,
      {
        ckbValue: ccc.fixedPointFrom(1000),
        udtValue: 0n,
      },
      {
        ckbScale: 3n,
        udtScale: 5n,
      },
      {
        feeRate: 0n,
        ckbAllowanceStep: ccc.fixedPointFrom(1),
        maxPartials: 1,
      },
    );
    expect(uncapped.match.partials).toHaveLength(2);
    expect(capped.match.partials).toHaveLength(1);
    expect(capped.match.ckbDelta).toBeLessThan(0n);
    expect(capped.match.udtDelta).toBeGreaterThan(0n);
  });
});

describe(`${ORDER_MATCHER_SUITE} zero partial cap`, () => {
  it("returns a complete empty result for a tiny domain", () => {
    const result = OrderManager.bestMatch(
      resolvedOrderGroups([makeUdtToCkbOrder({ udtValue: 1n })]),
      { ckbValue: 1n, udtValue: 0n },
      { ckbScale: 1n, udtScale: 1n },
      { feeRate: 0n, ckbAllowanceStep: 1n, maxPartials: 0 },
    );

    expect(result).toMatchObject({
      kind: "complete",
      match: {
        partials: [],
        diagnostics: {
          workCount: 1,
          generatedStates: { ckbToUdt: 1, udtToCkb: 1 },
          candidates: { total: 1, bestGain: 0n },
        },
      },
    });
  });
});

describe(`${ORDER_MATCHER_SUITE} dual singleton cap`, () => {
  it("evaluates dual singleton directions only against the empty opposite", () => {
    const ratio = { ckbScale: 1n, udtScale: 1n };
    const order = makeOrderCell({
      ckbUnoccupied: 400n,
      udtValue: 400n,
      info: Info.from({
        ckbToUdt: ratio,
        udtToCkb: ratio,
        ckbMinMatchLog: 0,
      }),
      master: {
        type: "absolute",
        value: { txHash: byte32FromByte("32"), index: 1n },
      },
      outPoint: { txHash: byte32FromByte("33"), index: 0n },
    });
    const groups = resolvedOrderGroups([order]);
    const allowance = { ckbValue: 400n, udtValue: 400n };
    const exchangeRate = { ckbScale: 1n, udtScale: 10n };
    const options = {
      feeRate: 1000n,
      ckbAllowanceStep: 1n,
      maxPartials: 1,
    };

    const result = OrderManager.bestMatch(groups, allowance, exchangeRate, options);

    expect(result.kind).toBe("complete");
    expect(result.match.partials).toHaveLength(1);
    expect(result.match.diagnostics?.candidates.rejected).toMatchObject({
      duplicateOrder: 0,
      maxPartials: 0,
    });
    expect(matchKey(result.match)).toEqual(
      matchKey(exhaustiveIntegerBestMatch(groups, allowance, exchangeRate, options)),
    );
  });
});
