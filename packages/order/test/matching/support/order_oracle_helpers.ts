import { validateMatch, type OracleInfo, type OrderState } from "@ickb/testkit";
import type { Match } from "../../../src/matching/match_types.ts";
import { OrderMatcher } from "../../../src/matching/order_matcher.ts";
import type { OrderCell } from "../../../src/model/cells.ts";
import type { Info } from "../../../src/model/info.ts";
import type { Ratio } from "../../../src/model/ratio.ts";
import { resolvedOrderGroup } from "./order_match_helpers.ts";
import { makeOrderCell } from "./order_order_helpers.ts";

/** Converts implementation order info into the oracle's independent shape. */
function oracleInfoFrom(info: Info): OracleInfo {
  const ratio = (r: Ratio): { ckbMul: bigint; udtMul: bigint } | undefined =>
    r.isEmpty() ? undefined : { ckbMul: r.ckbScale, udtMul: r.udtScale };
  return {
    ckbToUdt: ratio(info.ckbToUdt),
    udtToCkb: ratio(info.udtToCkb),
    ckbMinMatch: info.getCkbMinMatch(),
  };
}

/** Adjudicates one emitted match; returns the verdicts (one per partial). */
export function adjudicate(order: OrderCell, match: Match): string[] {
  const occupied = order.ckbValue - order.ckbUnoccupied;
  const input: OrderState = {
    ckb: order.ckbValue,
    udt: order.udtValue,
    ckbUnoccupied: order.ckbUnoccupied,
  };
  return match.partials.map((partial) => {
    const output: OrderState = {
      ckb: partial.ckbOut,
      udt: partial.udtOut,
      ckbUnoccupied: partial.ckbOut - occupied,
    };
    return validateMatch(input, output, oracleInfoFrom(order.data.info));
  });
}

/** Builds an order cell with fixed master and out point for oracle suites. */
export function orderWith(options: {
  info: Info;
  ckbUnoccupied: bigint;
  udtValue: bigint;
}): OrderCell {
  return makeOrderCell({
    ckbUnoccupied: options.ckbUnoccupied,
    udtValue: options.udtValue,
    info: options.info,
    master: { type: "absolute", value: { txHash: `0x${"ab".repeat(32)}`, index: 0n } },
    outPoint: { txHash: `0x${"cd".repeat(32)}`, index: 0n },
  });
}

/** Builds a matcher for the requested direction, throwing when unmatchable. */
export function mustMatcher(
  order: OrderCell,
  isCkb2Udt: boolean,
  ckbMiningFee = 0n,
): OrderMatcher {
  const matcher = OrderMatcher.from(resolvedOrderGroup(order), isCkb2Udt, ckbMiningFee);
  if (matcher === undefined) {
    throw new Error("Order is not matchable in the requested direction");
  }
  return matcher;
}
