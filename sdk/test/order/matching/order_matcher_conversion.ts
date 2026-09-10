import { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import { quoteConversion } from "../../../src/order/index.ts";
import { orderMatchers } from "../../../src/order/matching/order_match_context.ts";
import { OrderMatcher } from "../../../src/order/matching/order_matcher.ts";
import { Info } from "../../../src/order/model/info.ts";
import { Ratio } from "../../../src/order/model/ratio.ts";
import {
  OrderConversionRepresentabilityError,
  OrderManager,
} from "../../../src/order/order.ts";
import {
  ORDER_MATCHER_SUITE,
  RATIO_SCALE_EXCEEDS_UINT64,
} from "../fixtures/order_constants.ts";
import {
  exactAdjustedConversion,
  fullMatchOutput,
  makeUdtToCkbOrder,
  resolvedOrderGroup,
  resolvedOrderGroups,
} from "./support/order_match_helpers.ts";
import { byte32FromByte, makeOrderCell } from "./support/order_order_helpers.ts";
describe(ORDER_MATCHER_SUITE, () => {
  it("sorts effective ratios exactly beyond Number precision", () => {
    const order = makeUdtToCkbOrder({ udtValue: 100n });
    const group = resolvedOrderGroup(order);
    const scale = 2n ** 60n;
    const better = new OrderMatcher(group, true, {
      aScale: 1n,
      bScale: 1n,
      aIn: 0n,
      bIn: 0n,
      aMin: 0n,
      bMinMatch: 0n,
      bMaxMatch: 0n,
      bMaxOut: 0n,
      realRatioNumerator: scale + 1n,
      realRatioDenominator: scale,
    });
    const worse = new OrderMatcher(group, true, {
      aScale: 1n,
      bScale: 1n,
      aIn: 0n,
      bIn: 0n,
      aMin: 0n,
      bMinMatch: 0n,
      bMaxMatch: 0n,
      bMaxOut: 0n,
      realRatioNumerator: scale,
      realRatioDenominator: scale,
    });

    expect(Number(scale + 1n) / Number(scale)).toBe(1);
    expect(OrderMatcher.compareRealRatioDesc(better, worse)).toBeLessThan(0);
    expect(OrderMatcher.compareRealRatioDesc(worse, better)).toBeGreaterThan(0);
  });

  it("drops unmatchable orders before returning sorted matchers", () => {
    const validA = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: 0n,
      info: Info.create(true, { ckbScale: 1n, udtScale: 1n }),
      master: {
        type: "absolute",
        value: { txHash: byte32FromByte("31"), index: 1n },
      },
      outPoint: { txHash: byte32FromByte("41"), index: 0n },
    });
    const invalidDirection = makeUdtToCkbOrder({ orderTxHashByte: "42" });
    const validB = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(50),
      udtValue: 0n,
      info: Info.create(true, { ckbScale: 2n, udtScale: 1n }),
      master: {
        type: "absolute",
        value: { txHash: byte32FromByte("32"), index: 1n },
      },
      outPoint: { txHash: byte32FromByte("43"), index: 0n },
    });

    const matchers = orderMatchers(
      resolvedOrderGroups([validA, invalidDirection, validB]),
      true,
      0n,
    );

    expect(
      matchers.map((matcher) => matcher.group.order.cell.outPoint.toHex()),
    ).not.toContain(invalidDirection.cell.outPoint.toHex());
    expect(matchers).toHaveLength(2);
    const [firstMatcher, secondMatcher] = matchers;
    if (firstMatcher === undefined || secondMatcher === undefined) {
      throw new Error("Expected two matchers");
    }
    expect(
      OrderMatcher.compareRealRatioDesc(firstMatcher, secondMatcher),
    ).toBeLessThanOrEqual(0);
  });
});

describe(ORDER_MATCHER_SUITE, () => {
  it("reports UDT-to-CKB fee in CKB units", () => {
    const result = quoteConversion(
      false,
      Ratio.from({ ckbScale: 2n, udtScale: 1n }),
      { ckbValue: 0n, udtValue: 100n },
      { fee: 1n, feeBase: 10n },
    );

    expect(result.convertedAmount).toBe(45n);
    expect(result.ckbFee).toBe(5n);
    expect(fullMatchOutput(false, result.info, { ckbValue: 0n, udtValue: 100n })).toBe(
      45n,
    );
  });
});

describe(ORDER_MATCHER_SUITE, () => {
  it("encodes CKB-to-UDT quotes through a Uint64 ratio that preserves the full fill", () => {
    const midpoint = Ratio.from({
      ckbScale: (1n << 64n) - 1n,
      udtScale: (1n << 64n) - 2n,
    });
    const amounts = { ckbValue: 1000000n, udtValue: 0n };
    const result = quoteConversion(true, midpoint, amounts, {
      fee: 1n,
      feeBase: 100000n,
    });

    expect(() => midpoint.applyFee(true, 1n, 100000n)).toThrow(
      RATIO_SCALE_EXCEEDS_UINT64,
    );
    expect(result.convertedAmount).toBe(
      exactAdjustedConversion(true, midpoint, amounts.ckbValue, 1n, 100000n),
    );
    expect(result.info.ckbToUdt.ckbScale).toBeLessThanOrEqual((1n << 64n) - 1n);
    expect(result.info.ckbToUdt.udtScale).toBeLessThanOrEqual((1n << 64n) - 1n);
    expect(fullMatchOutput(true, result.info, amounts)).toBe(result.convertedAmount);
  });

  it("encodes UDT-to-CKB quotes through a Uint64 ratio that preserves the full fill", () => {
    const midpoint = Ratio.from({
      ckbScale: 10000000000000000n,
      udtScale: 11850413696044750n,
    });
    const amounts = { ckbValue: 0n, udtValue: 1000000n };
    const fee = 1185042n;
    const feeBase = 1185043n;
    const result = quoteConversion(false, midpoint, amounts, {
      fee,
      feeBase,
    });

    expect(() => midpoint.applyFee(false, fee, feeBase)).toThrow(
      RATIO_SCALE_EXCEEDS_UINT64,
    );
    expect(result.convertedAmount).toBe(
      exactAdjustedConversion(false, midpoint, amounts.udtValue, fee, feeBase),
    );
    expect(result.info.udtToCkb.ckbScale).toBeLessThanOrEqual((1n << 64n) - 1n);
    expect(result.info.udtToCkb.udtScale).toBeLessThanOrEqual((1n << 64n) - 1n);
    expect(fullMatchOutput(false, result.info, amounts)).toBe(result.convertedAmount);
  });
});

describe(ORDER_MATCHER_SUITE, () => {
  it("rejects zero-input quotes because they cannot mint a meaningful order ratio", () => {
    expect(() =>
      quoteConversion(
        true,
        Ratio.from({ ckbScale: 1n, udtScale: 1n }),
        { ckbValue: 0n, udtValue: 0n },
        { fee: 0n },
      ),
    ).toThrow(OrderConversionRepresentabilityError);
  });

  it("rejects quotes whose preserving interval has no Uint64 ratio", () => {
    expect(() =>
      quoteConversion(
        true,
        Ratio.from({ ckbScale: 1n, udtScale: 1n << 80n }),
        { ckbValue: 2n ** 80n, udtValue: 0n },
        { fee: 0n },
      ),
    ).toThrow(OrderConversionRepresentabilityError);
  });

  it("rejects preserving fractions whose terms cannot advance", () => {
    expect(() =>
      quoteConversion(
        true,
        Ratio.from({ ckbScale: 1n, udtScale: 1n << 96n }),
        { ckbValue: 1n << 96n, udtValue: 0n },
        { fee: 0n },
      ),
    ).toThrow(OrderConversionRepresentabilityError);
  });

  it("rejects preserving fractions whose bounded clamp cannot advance", () => {
    const maxUint64 = (1n << 64n) - 1n;

    expect(() =>
      quoteConversion(
        true,
        Ratio.from({ ckbScale: maxUint64 * 2n + 1n, udtScale: 2n }),
        { ckbValue: 2n, udtValue: 0n },
        { fee: 0n },
      ),
    ).toThrow(OrderConversionRepresentabilityError);
  });
});

describe(ORDER_MATCHER_SUITE, () => {
  it("uses udtToCkb scales for UDT-to-CKB orders", () => {
    const order = makeUdtToCkbOrder();
    const group = resolvedOrderGroup(order);

    const matcher = OrderMatcher.from(group, false, 0n);

    if (matcher === undefined) {
      throw new Error("Expected UDT-to-CKB order to be matchable");
    }
    expect(OrderMatcher.from(group, true, 0n)).toBeUndefined();
    expect(matcher.aScale).toBe(2n);
    expect(matcher.bScale).toBe(5n);
    expect(matcher.bMaxMatch).toBeGreaterThan(0n);
  });

  it("rejects invalid direct matcher construction", () => {
    const order = makeUdtToCkbOrder();
    const group = resolvedOrderGroup(order);
    const valid = {
      aScale: 1n,
      bScale: 1n,
      aIn: 0n,
      bIn: 0n,
      aMin: 0n,
      bMinMatch: 0n,
      bMaxMatch: 0n,
      bMaxOut: 0n,
      realRatioNumerator: 1n,
      realRatioDenominator: 1n,
    };
    const rejections: Array<[Partial<typeof valid>, string]> = [
      [{ aScale: 0n }, "OrderMatcher scales must be positive"],
      [
        { bMinMatch: 2n, bMaxMatch: 1n },
        "OrderMatcher maximum match must be at least the minimum match",
      ],
      [{ realRatioNumerator: 0n }, "OrderMatcher real ratio terms must be positive"],
    ];

    for (const [overrides, message] of rejections) {
      expect(() => new OrderMatcher(group, true, { ...valid, ...overrides })).toThrow(
        message,
      );
    }
  });

  it("rejects orders whose fee leaves no spendable input", () => {
    const order = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(1),
      udtValue: 0n,
      info: Info.create(true, { ckbScale: 1n, udtScale: 1n }, 0),
      master: {
        type: "absolute",
        value: {
          txHash: "0x3333333333333333333333333333333333333333333333333333333333333333",
          index: 1n,
        },
      },
      outPoint: {
        txHash: "0x4545454545454545454545454545454545454545454545454545454545454545",
        index: 0n,
      },
    });

    expect(
      OrderMatcher.from(resolvedOrderGroup(order), true, ccc.fixedPointFrom(2)),
    ).toBeUndefined();
  });

  it("rejects matcher parameters with a non-positive effective denominator", () => {
    const order = makeUdtToCkbOrder();

    expect(
      OrderMatcher.from(resolvedOrderGroup(order), false, -ccc.fixedPointFrom(100)),
    ).toBeUndefined();
  });
});

describe(ORDER_MATCHER_SUITE, () => {
  it("lets bestMatch consume UDT-to-CKB orders", () => {
    const order = makeUdtToCkbOrder();

    const { match } = OrderManager.bestMatch(
      [resolvedOrderGroup(order)],
      {
        ckbValue: 200n,
        udtValue: 0n,
      },
      {
        ckbScale: 3n,
        udtScale: 5n,
      },
      {
        feeRate: 0n,
      },
    );

    expect(match.partials).toHaveLength(1);
    expect(match.ckbDelta).toBeLessThan(0n);
    expect(match.udtDelta).toBeGreaterThan(0n);
    expect(match.diagnostics).toMatchObject({
      orderCount: 1,
      directions: {
        ckbToUdt: { matchableCount: 0 },
        udtToCkb: { matchableCount: 1 },
      },
    });
    expect(match.diagnostics?.bestGain).toBeGreaterThan(0n);
  });
});
