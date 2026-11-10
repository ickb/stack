import { ccc } from "@ckb-ccc/core";
import { byte32FromByte } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import { quoteConversion, quoteOrder } from "../../../src/order/conversion.ts";
import { Info } from "../../../src/order/info.ts";
import { OrderMatcher } from "../../../src/order/matcher.ts";
import { Ratio } from "../../../src/order/ratio.ts";
import {
  exactAdjustedConversion,
  fullMatchOutput,
  makeUdtToCkbOrder,
  resolvedOrderGroup,
  resolvedOrderGroups,
} from "./support/order_match_helpers.ts";
import { makeOrderCell } from "./support/order_order_helpers.ts";

const ORDER_MATCHER_SUITE = "OrderMatcher";
const UNREPRESENTABLE = { ok: false, reason: "unrepresentable" };

/** The quote, which these cases expect an order ratio to represent. */
function quoted(
  result: ReturnType<typeof quoteOrder>,
): Extract<typeof result, { ok: true }> {
  if (!result.ok) {
    throw new Error("Expected a representable quote");
  }
  return result;
}

describe(ORDER_MATCHER_SUITE, () => {
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

    const matchers = resolvedOrderGroups([validA, invalidDirection, validB]).flatMap(
      (group) => OrderMatcher.from(group, true, 0n) ?? [],
    );

    expect(
      matchers.map((matcher) => matcher.group.order.cell.outPoint.toHex()),
    ).not.toContain(invalidDirection.cell.outPoint.toHex());
    expect(matchers).toHaveLength(2);
  });
});

describe(ORDER_MATCHER_SUITE, () => {
  it("quotes at the SDK's default fee when none is given", () => {
    const ratio = Ratio.from({ ckbScale: 1n, udtScale: 1n });

    expect(quoteConversion("ckb-to-ickb", ratio, 100000n)).toMatchObject({ ckbFee: 10n });
    expect(quoteOrder("ckb-to-ickb", ratio, 100000n, { fee: 20n })).toMatchObject({
      ckbFee: 20n,
    });
  });

  it("reports UDT-to-CKB fee in CKB units", () => {
    const result = quoted(
      quoteOrder("ickb-to-ckb", Ratio.from({ ckbScale: 2n, udtScale: 1n }), 100n, {
        fee: 1n,
        feeBase: 10n,
      }),
    );

    expect(result.convertedAmount).toBe(45n);
    expect(result.ckbFee).toBe(5n);
    expect(fullMatchOutput(false, result.info, { ckbValue: 0n, udtValue: 100n })).toBe(
      45n,
    );
  });

  it("reports no fee for a fee-free quote, whatever its rounding", () => {
    // One shannon buys a third of a UDT unit, quoted up to one.
    const result = quoted(
      quoteOrder("ckb-to-ickb", Ratio.from({ ckbScale: 1n, udtScale: 3n }), 1n, {
        fee: 0n,
        feeBase: 10n,
      }),
    );

    expect(result.convertedAmount).toBe(1n);
    expect(result.ckbFee).toBe(0n);
  });
});

describe(ORDER_MATCHER_SUITE, () => {
  it("encodes CKB-to-UDT quotes through a Uint64 ratio that preserves the full fill", () => {
    const midpoint = Ratio.from({
      ckbScale: (1n << 64n) - 1n,
      udtScale: (1n << 64n) - 2n,
    });
    const amounts = { ckbValue: 1000000n, udtValue: 0n };
    const result = quoted(
      quoteOrder("ckb-to-ickb", midpoint, amounts.ckbValue, {
        fee: 1n,
        feeBase: 100000n,
      }),
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
    const result = quoted(
      quoteOrder("ickb-to-ckb", midpoint, amounts.udtValue, {
        fee,
        feeBase,
      }),
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
  it("finds zero-input quotes unrepresentable: they cannot mint a meaningful order ratio", () => {
    expect(
      quoteOrder("ckb-to-ickb", Ratio.from({ ckbScale: 1n, udtScale: 1n }), 0n, {
        fee: 0n,
        feeBase: 100000n,
      }),
    ).toEqual(UNREPRESENTABLE);
  });

  it("finds quotes unrepresentable whose preserving interval has no Uint64 ratio", () => {
    expect(
      quoteOrder(
        "ckb-to-ickb",
        Ratio.from({ ckbScale: 1n, udtScale: 1n << 80n }),
        2n ** 80n,
        { fee: 0n, feeBase: 100000n },
      ),
    ).toEqual(UNREPRESENTABLE);
  });

  it("finds a quote unrepresentable whose only preserving ratio has a term just past Uint64", () => {
    expect(
      quoteOrder("ckb-to-ickb", Ratio.from({ ckbScale: 1n << 64n, udtScale: 1n }), 1n, {
        fee: 0n,
        feeBase: 100000n,
      }),
    ).toEqual(UNREPRESENTABLE);
  });

  it("finds a quote unrepresentable whose bounded fraction would round the input below it", () => {
    // The quote is 2^65 - 1; the closest Uint64 fraction under it, (2^64 - 2) / (2^64 - 1),
    // rounds 2^65 up to only 2^65 - 2.
    expect(
      quoteOrder(
        "ckb-to-ickb",
        Ratio.from({ ckbScale: (1n << 65n) - 1n, udtScale: 1n << 65n }),
        1n << 65n,
        { fee: 0n, feeBase: 100000n },
      ),
    ).toEqual(UNREPRESENTABLE);
  });

  it("finds a quote unrepresentable whose preserving fraction's terms cannot advance", () => {
    expect(
      quoteOrder(
        "ckb-to-ickb",
        Ratio.from({ ckbScale: 1n, udtScale: 1n << 96n }),
        1n << 96n,
        { fee: 0n, feeBase: 100000n },
      ),
    ).toEqual(UNREPRESENTABLE);
  });

  it("finds a quote unrepresentable whose preserving fraction's bounded clamp cannot advance", () => {
    const maxUint64 = (1n << 64n) - 1n;

    expect(
      quoteOrder(
        "ckb-to-ickb",
        Ratio.from({ ckbScale: maxUint64 * 2n + 1n, udtScale: 2n }),
        2n,
        { fee: 0n, feeBase: 100000n },
      ),
    ).toEqual(UNREPRESENTABLE);
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

  it("rejects orders whose fee takes all their spendable input", () => {
    const order = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(1),
      udtValue: 0n,
      info: Info.from({
        ckbToUdt: { ckbScale: 1n, udtScale: 1n },
        udtToCkb: Ratio.empty(),
        ckbMinMatchLog: 0,
      }),
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
      OrderMatcher.from(resolvedOrderGroup(order), true, ccc.fixedPointFrom(1)),
    ).toBeUndefined();
  });
});
