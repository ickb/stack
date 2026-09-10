/**
 * UDT limit-order entities, matching helpers, and transaction builders.
 *
 * @packageDocumentation
 */

export { MasterCell, OrderCell, OrderGroup } from "./model/cells.ts";
export { Info, type InfoLike } from "./model/info.ts";
export { type Master, type MasterLike } from "./model/master.ts";
export { OrderData, type OrderDataLike } from "./model/order_data.ts";
export { Ratio } from "./model/ratio.ts";
export { Relative, type RelativeLike } from "./model/relative.ts";
export {
  OrderConversionRepresentabilityError,
  OrderManager,
  type BestMatchOptions,
  type Match,
  type MatchDiagnostics,
  type MatchDirectionDiagnostics,
  type MatchSearchResult,
  type OrderGroupSkipReason,
} from "./order.ts";
