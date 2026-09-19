import type { ccc } from "@ckb-ccc/core";
import { ceilDiv, minBigInt } from "../utils/index.ts";
import type { OrderCell, OrderGroup } from "./cells.ts";

/**
 * The fills of one or more orders from the matcher caller's perspective.
 */
export interface Match {
  /** Net CKB change from the match. */
  ckbDelta: bigint;

  /** Net UDT change from the match. */
  udtDelta: bigint;

  /** Partial order outputs that must replace matched order inputs. */
  partials: Array<{
    /** Resolved group that proves the matched order's mint origin. */
    group: OrderGroup;

    /** CKB capacity for the replacement partial order output. */
    ckbOut: ccc.FixedPoint;

    /** UDT amount for the replacement partial order output. */
    udtOut: ccc.FixedPoint;
  }>;
}

/**
 * One order's fills in one direction, in the contract's terms: `a` is the asset the order
 * gives, `b` the asset the caller pays. A partial pays `b` between `bMinMatch` and
 * `bMaxMatch`; paying `bMaxMatch` completes the order.
 */
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

  private constructor(
    group: OrderGroup,
    isCkb2Udt: boolean,
    { aScale, bScale, aIn, bIn, aMin, bMinMatch, bMaxMatch, bMaxOut }: OrderMatcherTerms,
  ) {
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
  }

  /** The order's matcher in one direction, or `undefined` when nothing gains in it. */
  public static from(
    group: OrderGroup,
    isCkb2Udt: boolean,
    ckbMiningFee: ccc.FixedPoint,
  ): OrderMatcher | undefined {
    const terms = orderMatcherTerms(group.order, isCkb2Udt, ckbMiningFee);
    return terms === undefined ? undefined : new OrderMatcher(group, isCkb2Udt, terms);
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

interface OrderMatcherTerms {
  aScale: ccc.Num;
  bScale: ccc.Num;
  aIn: ccc.FixedPoint;
  bIn: ccc.FixedPoint;
  aMin: ccc.FixedPoint;
  bMinMatch: ccc.FixedPoint;
  bMaxMatch: ccc.FixedPoint;
  bMaxOut: ccc.FixedPoint;
}

function orderMatcherTerms(
  order: OrderCell,
  isCkb2Udt: boolean,
  ckbMiningFee: ccc.FixedPoint,
): OrderMatcherTerms | undefined {
  if (isCkb2Udt ? !order.isCkb2UdtMatchable() : !order.isUdt2CkbMatchable()) {
    return undefined;
  }
  const { info } = order.data;
  const ckbMinMatch = info.getCkbMinMatch();
  let terms: Omit<OrderMatcherTerms, "bMaxMatch" | "bMaxOut">;
  if (isCkb2Udt) {
    const { ckbScale: aScale, udtScale: bScale } = info.ckbToUdt;
    terms = {
      aScale,
      bScale,
      aIn: order.ckbValue,
      bIn: order.udtValue,
      aMin: order.cell.cellOutput.capacity - order.ckbUnoccupied,
      // The contract's ckb2udt minimum is a plain CKB delta (limit_order entry.rs:116);
      // a value-conserving partial moving u UDT moves u*udtScale/ckbScale CKB, so the
      // UDT-denominated floor is ceil(minMatch * ckbScale / udtScale).
      bMinMatch: ceilDiv(ckbMinMatch * aScale, bScale),
    };
  } else {
    const { ckbScale: bScale, udtScale: aScale } = info.udtToCkb;
    // The contract's udt2ckb minimum values the UDT moved at the ratio, and a payment of
    // p CKB moves floor(p*bScale/aScale) UDT, so the smallest payment the contract accepts
    // is the one whose floor reaches ceil(min*bScale/aScale) UDT: the plain minimum,
    // rounded up to the ratio's grid.
    const udtMinMatch = ceilDiv(ckbMinMatch * bScale, aScale);
    terms = {
      aScale,
      bScale,
      aIn: order.udtValue,
      bIn: order.ckbValue,
      aMin: 0n,
      bMinMatch: ceilDiv(udtMinMatch * aScale, bScale),
    };
  }

  const { aScale, bScale, aIn, bIn, aMin, bMinMatch } = terms;
  // A buyer pays the fill's mining fee out of the CKB it gives, so nothing gains once the
  // fee eats that; a seller's fill brings CKB in, and its caller nets the fee (`netOf`).
  if (aIn <= aMin + (isCkb2Udt ? ckbMiningFee : 0n)) {
    return undefined;
  }
  const bMaxOut = nonDecreasing({ aScale, bScale, aIn, bIn, aOut: aMin });
  const bMaxMatch = bMaxOut - bIn;
  return {
    ...terms,
    // An order under its own minimum can only be completed.
    bMinMatch: minBigInt(bMinMatch, bMaxMatch),
    bMaxMatch,
    bMaxOut,
  };
}

/** The smallest `b` output that keeps the order's value non-decreasing at its ratio. */
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
  return ceilDiv(aScale * (aIn - aOut) + bScale * bIn, bScale);
}
