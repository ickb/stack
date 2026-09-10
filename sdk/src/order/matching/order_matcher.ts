import type { ccc } from "@ckb-ccc/core";
import { compareBigInt } from "../../utils/index.ts";
import type { OrderCell, OrderGroup } from "../model/cells.ts";
import type { Match } from "./match_types.ts";

export interface OrderMatcherParameters {
  aScale: ccc.Num;
  bScale: ccc.Num;
  aIn: ccc.FixedPoint;
  bIn: ccc.FixedPoint;
  aMin: ccc.FixedPoint;
  bMinMatch: ccc.FixedPoint;
  bMaxMatch: ccc.FixedPoint;
  bMaxOut: ccc.FixedPoint;
  realRatioNumerator: ccc.FixedPoint;
  realRatioDenominator: ccc.FixedPoint;
}

interface OrderMatcherValues {
  aScale: ccc.Num;
  bScale: ccc.Num;
  aIn: ccc.FixedPoint;
  bIn: ccc.FixedPoint;
  aMin: ccc.FixedPoint;
  bMinMatch: ccc.FixedPoint;
  aMiningFee: ccc.FixedPoint;
  bMiningFee: ccc.FixedPoint;
}

export class OrderMatcher {
  public readonly group: OrderGroup;
  public readonly isCkb2Udt: boolean;
  public readonly aScale: ccc.Num;
  public readonly bScale: ccc.Num;
  public readonly aIn: ccc.FixedPoint;
  public readonly bIn: ccc.FixedPoint;
  public readonly aMin: ccc.FixedPoint;
  public readonly bMinMatch: ccc.FixedPoint;
  public readonly bMaxMatch: ccc.FixedPoint;
  public readonly bMaxOut: ccc.FixedPoint;
  public readonly realRatioNumerator: ccc.FixedPoint;
  public readonly realRatioDenominator: ccc.FixedPoint;

  constructor(group: OrderGroup, isCkb2Udt: boolean, parameters: OrderMatcherParameters) {
    assertOrderMatcherParameters(parameters);
    const {
      aScale,
      bScale,
      aIn,
      bIn,
      aMin,
      bMinMatch,
      bMaxMatch,
      bMaxOut,
      realRatioNumerator,
      realRatioDenominator,
    } = parameters;
    this.group = group;
    this.isCkb2Udt = isCkb2Udt;
    this.aScale = aScale;
    this.bScale = bScale;
    this.aIn = aIn;
    this.bIn = bIn;
    this.aMin = aMin;
    this.bMinMatch = bMinMatch;
    this.bMaxMatch = bMaxMatch;
    this.bMaxOut = bMaxOut;
    this.realRatioNumerator = realRatioNumerator;
    this.realRatioDenominator = realRatioDenominator;
  }

  public static compareRealRatioDesc(left: OrderMatcher, right: OrderMatcher): number {
    return compareBigInt(
      right.realRatioNumerator * left.realRatioDenominator,
      left.realRatioNumerator * right.realRatioDenominator,
    );
  }

  public static from(
    group: OrderGroup,
    isCkb2Udt: boolean,
    ckbMiningFee: ccc.FixedPoint,
  ): OrderMatcher | undefined {
    const parameters = orderMatcherParameters(group.order, isCkb2Udt, ckbMiningFee);
    return parameters === undefined
      ? undefined
      : new OrderMatcher(group, isCkb2Udt, parameters);
  }

  public match(bAllowance: ccc.FixedPoint): Match {
    if (bAllowance < this.bMinMatch) {
      return { ckbDelta: 0n, udtDelta: 0n, partials: [] };
    }

    if (bAllowance >= this.bMaxMatch) {
      return this.create(this.aMin, this.bMaxOut);
    }

    const bOut = this.bIn + bAllowance;
    const aOut = nonDecreasing({
      aScale: this.bScale,
      bScale: this.aScale,
      aIn: this.bIn,
      bIn: this.aIn,
      aOut: bOut,
    });

    // limit_order's udt2ckb minimum on the UDT moved, valued at the ratio; bMinMatch
    // is that bound rounded up to the ratio's grid, so this fires only on direct
    // construction.
    if (
      !this.isCkb2Udt &&
      this.aIn * this.aScale <
        aOut * this.aScale + this.group.order.data.info.getCkbMinMatch() * this.bScale
    ) {
      return { ckbDelta: 0n, udtDelta: 0n, partials: [] };
    }

    // limit_order entry.rs:116 mirrored as defense-in-depth: for matchers built via
    // from(), the bMinMatch pre-gate is provably equivalent (floor(u*b/a) >= m iff
    // u >= ceil(m*a/b), fee-invariant — see order_matcher_properties.ts reachability
    // suite), so this fires only on direct-constructor misconstruction.
    if (
      this.isCkb2Udt &&
      aOut !== this.aMin &&
      this.aIn < aOut + this.group.order.data.info.getCkbMinMatch()
    ) {
      return { ckbDelta: 0n, udtDelta: 0n, partials: [] };
    }

    return this.create(aOut, bOut);
  }

  public create(aOut: ccc.FixedPoint, bOut: ccc.FixedPoint): Match {
    return this.isCkb2Udt
      ? {
          ckbDelta: this.aIn - aOut,
          udtDelta: this.bIn - bOut,
          partials: [{ group: this.group, ckbOut: aOut, udtOut: bOut }],
        }
      : {
          ckbDelta: this.bIn - bOut,
          udtDelta: this.aIn - aOut,
          partials: [{ group: this.group, ckbOut: bOut, udtOut: aOut }],
        };
  }
}

function orderMatcherParameters(
  order: OrderCell,
  isCkb2Udt: boolean,
  ckbMiningFee: ccc.FixedPoint,
): OrderMatcherParameters | undefined {
  const values = orderMatcherValues(order, isCkb2Udt, ckbMiningFee);
  if (values === undefined) {
    return undefined;
  }

  const { aScale, bScale, aIn, bIn, aMin, bMinMatch, aMiningFee, bMiningFee } = values;
  if (aIn <= aMin + aMiningFee || aScale <= 0n || bScale <= 0n) {
    return undefined;
  }

  const bMaxOut = nonDecreasing({ aScale, bScale, aIn, bIn, aOut: aMin });
  const bMaxMatch = bMaxOut - bIn;
  const realRatioNumerator = aIn - aMin - aMiningFee;
  const realRatioDenominator = bMaxMatch + bMiningFee;
  if (realRatioNumerator <= 0n || realRatioDenominator <= 0n) {
    return undefined;
  }

  return {
    aScale,
    bScale,
    aIn,
    bIn,
    aMin,
    bMinMatch: minBigInt(bMinMatch, bMaxMatch),
    bMaxMatch,
    bMaxOut,
    realRatioNumerator,
    realRatioDenominator,
  };
}

function orderMatcherValues(
  order: OrderCell,
  isCkb2Udt: boolean,
  ckbMiningFee: ccc.FixedPoint,
): OrderMatcherValues | undefined {
  if (isCkb2Udt ? !order.isCkb2UdtMatchable() : !order.isUdt2CkbMatchable()) {
    return undefined;
  }

  if (isCkb2Udt) {
    const { ckbScale: aScale, udtScale: bScale } = order.data.info.ckbToUdt;
    return {
      aScale,
      bScale,
      aIn: order.ckbValue,
      bIn: order.udtValue,
      aMin: order.cell.cellOutput.capacity - order.ckbUnoccupied,
      // The contract's ckb2udt minimum is a plain CKB delta (limit_order entry.rs:116);
      // a value-conserving partial moving u UDT moves u*udtScale/ckbScale CKB, so the
      // UDT-denominated floor is ceil(minMatch * ckbScale / udtScale) = m*aScale/bScale.
      bMinMatch: (order.data.info.getCkbMinMatch() * aScale + bScale - 1n) / bScale,
      aMiningFee: ckbMiningFee,
      bMiningFee: 0n,
    };
  }

  const { ckbScale: bScale, udtScale: aScale } = order.data.info.udtToCkb;
  // The contract's udt2ckb minimum values the UDT moved at the ratio, and a payment of
  // p CKB moves floor(p*bScale/aScale) UDT, so the smallest payment the contract accepts
  // is the one whose floor reaches ceil(min*bScale/aScale) UDT: the plain minimum,
  // rounded up to the ratio's grid.
  const ckbMinMatch = order.data.info.getCkbMinMatch();
  const udtMinMatch = (ckbMinMatch * bScale + aScale - 1n) / aScale;
  return {
    aScale,
    bScale,
    aIn: order.udtValue,
    bIn: order.ckbValue,
    aMin: 0n,
    bMinMatch: (udtMinMatch * aScale + bScale - 1n) / bScale,
    aMiningFee: 0n,
    bMiningFee: ckbMiningFee,
  };
}

function nonDecreasing({
  aScale,
  bScale,
  aIn,
  bIn,
  aOut,
}: {
  aScale: ccc.Num;
  bScale: ccc.Num;
  aIn: ccc.FixedPoint;
  bIn: ccc.FixedPoint;
  aOut: ccc.FixedPoint;
}): ccc.FixedPoint {
  return (aScale * (aIn - aOut) + bScale * (bIn + 1n) - 1n) / bScale;
}

function minBigInt(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}

function assertOrderMatcherParameters({
  aScale,
  bScale,
  aIn,
  bIn,
  aMin,
  bMinMatch,
  bMaxMatch,
  bMaxOut,
  realRatioNumerator,
  realRatioDenominator,
}: {
  aScale: ccc.Num;
  bScale: ccc.Num;
  aIn: ccc.FixedPoint;
  bIn: ccc.FixedPoint;
  aMin: ccc.FixedPoint;
  bMinMatch: ccc.FixedPoint;
  bMaxMatch: ccc.FixedPoint;
  bMaxOut: ccc.FixedPoint;
  realRatioNumerator: ccc.FixedPoint;
  realRatioDenominator: ccc.FixedPoint;
}): void {
  if (aScale <= 0n || bScale <= 0n) {
    throw new Error("OrderMatcher scales must be positive");
  }
  if (realRatioNumerator <= 0n || realRatioDenominator <= 0n) {
    throw new Error("OrderMatcher real ratio terms must be positive");
  }
  for (const [name, value] of [
    ["aIn", aIn],
    ["bIn", bIn],
    ["aMin", aMin],
    ["bMinMatch", bMinMatch],
    ["bMaxMatch", bMaxMatch],
    ["bMaxOut", bMaxOut],
  ] as const) {
    if (value < 0n) {
      throw new Error(`OrderMatcher ${name} must be non-negative`);
    }
  }
  if (bMaxMatch < bMinMatch) {
    throw new Error("OrderMatcher maximum match must be at least the minimum match");
  }
}
