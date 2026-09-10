import type { ExchangeRatio, ValueComponents } from "../../utils/index.ts";
import { maxOrderOccupiedSize } from "../io/order_io.ts";
import { validatedOrderGroup, type OrderGroup } from "../model/cells.ts";
import type { MatchSearchResult } from "./match_types.ts";
import { createBestMatchContext, type BestMatchOptions } from "./order_match_context.ts";
import { searchBestMatch } from "./order_match_search.ts";

export type { Match, MatchDiagnostics, MatchSearchResult } from "./match_types.ts";
export type { BestMatchOptions } from "./order_match_context.ts";

export function bestMatch(
  orderPool: OrderGroup[],
  allowance: ValueComponents,
  exchangeRate: ExchangeRatio,
  options?: BestMatchOptions,
): MatchSearchResult {
  const resolvedGroups = orderPool.map(validatedOrderGroup);
  const orderSize = maxOrderOccupiedSize(resolvedGroups);
  const context = createBestMatchContext({
    orderPool: resolvedGroups,
    allowance,
    exchangeRate,
    orderSize,
    options,
  });
  if (orderSize === 0) {
    return {
      kind: "complete",
      match: { ckbDelta: 0n, udtDelta: 0n, partials: [] },
    };
  }

  return searchBestMatch(context);
}
