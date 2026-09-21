import { ccc } from "@ckb-ccc/core";
import type { StubClientHandlers } from "@ickb/testkit";

export const ORDER_MATCHER_SUITE = "OrderMatcher";
export const ORDER_CELL_RESOLVE_SUITE = "OrderCell.resolve";
export const ORDER_MANAGER_FIND_ORDERS_SUITE = "OrderManager.findOrders";
export const NO_CELLS: readonly ccc.Cell[] = [];

type FindCellsHandler = NonNullable<StubClientHandlers["findCellsPagedNoCache"]>;
export type FindCellsQuery = Parameters<FindCellsHandler>[0];
export type FindCellsLimit = Parameters<FindCellsHandler>[2];
export type GetTransactionHash = Parameters<ccc.Client["getTransaction"]>[0];
export type GetTransactionReturn = ReturnType<ccc.Client["getTransaction"]>;

export function mustPageSize(pageSize: FindCellsLimit): number {
  if (pageSize === undefined) {
    throw new Error("Expected page size");
  }
  return Number(ccc.numFrom(pageSize));
}
