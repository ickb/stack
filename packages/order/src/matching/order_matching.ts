import type { ExchangeRatio, ValueComponents } from "@ickb/utils";
import { maxOrderOccupiedSize } from "../io/order_io.ts";
import type { OrderCell } from "../model/cells.ts";
import type { Match } from "./match_types.ts";
import { createBestMatchContext, type BestMatchOptions } from "./order_match_context.ts";
import { searchBestMatch } from "./order_match_search.ts";

export type {
  Match,
  MatchDiagnostics,
  MatchDirectionDiagnostics,
} from "./match_types.ts";
export { orderMatchers, sequentialMatches } from "./order_match_sequence.ts";
export { OrderMatcher } from "./order_matcher.ts";

export function bestMatch(
  orderPool: OrderCell[],
  allowance: ValueComponents,
  exchangeRate: ExchangeRatio,
  options?: BestMatchOptions,
): Match {
  const orderSize = maxOrderOccupiedSize(orderPool);
  if (orderSize === 0) {
    return { ckbDelta: 0n, udtDelta: 0n, partials: [] };
  }

  return searchBestMatch(
    createBestMatchContext({ orderPool, allowance, exchangeRate, orderSize, options }),
  );
}
