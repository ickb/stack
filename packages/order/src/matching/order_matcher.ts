import type { ccc } from "@ckb-ccc/core";
import { compareBigInt } from "@ickb/utils";
import type { OrderCell } from "../model/cells.ts";
import type { Match } from "./match_types.ts";

type OrderMatcherParameters = [
  aScale: ccc.Num,
  bScale: ccc.Num,
  aIn: ccc.FixedPoint,
  bIn: ccc.FixedPoint,
  aMin: ccc.FixedPoint,
  bMinMatch: ccc.FixedPoint,
  bMaxMatch: ccc.FixedPoint,
  bMaxOut: ccc.FixedPoint,
  realRatioNumerator: ccc.FixedPoint,
  realRatioDenominator: ccc.FixedPoint,
];

type OrderMatcherConstructorArgs = [
  order: OrderCell,
  isCkb2Udt: boolean,
  ...parameters: OrderMatcherParameters,
];

type NonDecreasingArgs = [
  aScale: ccc.Num,
  bScale: ccc.Num,
  aIn: ccc.FixedPoint,
  bIn: ccc.FixedPoint,
  aOut: ccc.FixedPoint,
];

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
  public readonly order: OrderCell;
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

  constructor(
    ...[
      order,
      isCkb2Udt,
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
    ]: OrderMatcherConstructorArgs
  ) {
    assertOrderMatcherParameters({
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
    });
    this.order = order;
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
    order: OrderCell,
    isCkb2Udt: boolean,
    ckbMiningFee: ccc.FixedPoint,
  ): OrderMatcher | undefined {
    const parameters = orderMatcherParameters(order, isCkb2Udt, ckbMiningFee);
    return parameters === undefined
      ? undefined
      : new OrderMatcher(order, isCkb2Udt, ...parameters);
  }

  public match(bAllowance: ccc.FixedPoint): Match {
    if (bAllowance < this.bMinMatch) {
      return { ckbDelta: 0n, udtDelta: 0n, partials: [] };
    }

    if (bAllowance >= this.bMaxMatch) {
      return this.create(this.aMin, this.bMaxOut);
    }

    const bOut = this.bIn + bAllowance;
    const aOut = nonDecreasing(this.bScale, this.aScale, this.bIn, this.aIn, bOut);

    if (
      !this.isCkb2Udt &&
      this.aIn * this.aScale < aOut * this.aScale + this.bMinMatch * this.bScale
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
          partials: [{ order: this.order, ckbOut: aOut, udtOut: bOut }],
        }
      : {
          ckbDelta: this.bIn - bOut,
          udtDelta: this.aIn - aOut,
          partials: [{ order: this.order, ckbOut: bOut, udtOut: aOut }],
        };
  }

  public static nonDecreasing(
    ...[aScale, bScale, aIn, bIn, aOut]: NonDecreasingArgs
  ): ccc.FixedPoint {
    return nonDecreasing(aScale, bScale, aIn, bIn, aOut);
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

  const bMaxOut = nonDecreasing(aScale, bScale, aIn, bIn, aMin);
  const bMaxMatch = bMaxOut - bIn;
  const realRatioNumerator = aIn - aMin - aMiningFee;
  const realRatioDenominator = bMaxMatch + bMiningFee;
  if (realRatioNumerator <= 0n || realRatioDenominator <= 0n) {
    return undefined;
  }

  return [
    aScale,
    bScale,
    aIn,
    bIn,
    aMin,
    minBigInt(bMinMatch, bMaxMatch),
    bMaxMatch,
    bMaxOut,
    realRatioNumerator,
    realRatioDenominator,
  ];
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
      bMinMatch: (order.data.info.getCkbMinMatch() * bScale + aScale - 1n) / aScale,
      aMiningFee: ckbMiningFee,
      bMiningFee: 0n,
    };
  }

  const { ckbScale: bScale, udtScale: aScale } = order.data.info.udtToCkb;
  return {
    aScale,
    bScale,
    aIn: order.udtValue,
    bIn: order.ckbValue,
    aMin: 0n,
    bMinMatch: order.data.info.getCkbMinMatch(),
    aMiningFee: 0n,
    bMiningFee: ckbMiningFee,
  };
}

function nonDecreasing(
  ...[aScale, bScale, aIn, bIn, aOut]: NonDecreasingArgs
): ccc.FixedPoint {
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
