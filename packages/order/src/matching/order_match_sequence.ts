import type { ccc } from "@ckb-ccc/core";
import { compareBigInt } from "@ickb/utils";
import type { OrderCell } from "../model/cells.ts";
import type { Match, MatchDirectionDiagnostics } from "./match_types.ts";
import { OrderMatcher } from "./order_matcher.ts";

export function orderMatchers(
  orderPool: OrderCell[],
  isCkb2Udt: boolean,
  ckbMiningFee: ccc.FixedPoint,
): OrderMatcher[] {
  return orderPool
    .map((o) => OrderMatcher.from(o, isCkb2Udt, ckbMiningFee))
    .filter((matcher): matcher is OrderMatcher => matcher !== undefined)
    .toSorted((a, b) => OrderMatcher.compareRealRatioDesc(a, b));
}

export function* sequentialMatches(
  matchers: OrderMatcher[],
  allowanceStep: ccc.FixedPoint,
): Generator<Match, void, void> {
  if (allowanceStep <= 0n) {
    throw new Error("Allowance step must be positive");
  }
  let acc: Match = emptyMatch();
  let curr = acc;
  yield curr;

  for (const matcher of matchers) {
    const maxMatch = matcher.bMaxMatch;
    const N = (maxMatch + allowanceStep - 1n) / allowanceStep;
    const q = maxMatch / N;
    const r = maxMatch % N;
    let allowance = 0n;

    for (let i = 0n; i < N; i++) {
      allowance += i < r ? q + 1n : q;
      const m = matcher.match(allowance);
      if (m.partials.length === 0) {
        continue;
      }
      curr = {
        ckbDelta: acc.ckbDelta + m.ckbDelta,
        udtDelta: acc.udtDelta + m.udtDelta,
        partials: acc.partials.concat(m.partials),
      };
      yield curr;
    }
    acc = curr;
  }
}

export function summarizeMatchers(matchers: OrderMatcher[]): MatchDirectionDiagnostics {
  const matchableCount = matchers.length;
  let minAllowance: ccc.FixedPoint | undefined;
  let maxMatch: ccc.FixedPoint | undefined;
  for (const matcher of matchers) {
    minAllowance =
      minAllowance === undefined || compareBigInt(matcher.bMinMatch, minAllowance) < 0
        ? matcher.bMinMatch
        : minAllowance;
    maxMatch =
      maxMatch === undefined || compareBigInt(matcher.bMaxMatch, maxMatch) > 0
        ? matcher.bMaxMatch
        : maxMatch;
  }

  return {
    matchableCount,
    ...(minAllowance === undefined ? {} : { minAllowance }),
    ...(maxMatch === undefined ? {} : { maxMatch }),
  };
}

function emptyMatch(): Match {
  return { ckbDelta: 0n, udtDelta: 0n, partials: [] };
}
