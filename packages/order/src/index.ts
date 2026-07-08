/**
 * UDT limit-order entities, matching helpers, and transaction builders.
 *
 * @packageDocumentation
 */

export {
  MasterCell,
  OrderCell,
  OrderGroup,
  type OrderCellConstructorArgs,
} from "./model/cells.ts";
export { Info, InfoBase, type InfoLike } from "./model/info.ts";
export { type Master, type MasterLike } from "./model/master.ts";
export { OrderBase, OrderData, type OrderDataLike } from "./model/order_data.ts";
export { Ratio, RatioBase } from "./model/ratio.ts";
export { Relative, RelativeBase, type RelativeLike } from "./model/relative.ts";
export {
  OrderConversionRepresentabilityError,
  OrderManager,
  type Match,
  type MatchDiagnostics,
  type MatchDirectionDiagnostics,
  type OrderGroupSkipReason,
} from "./order.ts";
