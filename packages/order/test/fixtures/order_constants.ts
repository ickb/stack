import type { ccc } from "@ckb-ccc/core";
import type { StubClient } from "@ickb/testkit";

export const RATIO_SCALE_EXCEEDS_UINT64 = "Ratio scale exceeds Uint64";
export const ORDER_MATCHER_SUITE = "OrderMatcher";
export const ORDER_CELL_RESOLVE_SUITE = "OrderCell.resolve";
export const ORDER_MANAGER_FIND_ORDERS_SUITE = "OrderManager.findOrders";
export const NO_CELLS: readonly ccc.Cell[] = [];

type StubClientOptions = NonNullable<ConstructorParameters<typeof StubClient>[0]>;
type FindCellsOnChainHandler = NonNullable<StubClientOptions["findCellsOnChain"]>;
export type FindCellsOnChainQuery = Parameters<FindCellsOnChainHandler>[0];
export type FindCellsOnChainOrder = Parameters<FindCellsOnChainHandler>[1];
export type FindCellsOnChainLimit = Parameters<FindCellsOnChainHandler>[2];
export type FindCellsOnChainReturn = ReturnType<FindCellsOnChainHandler>;
export type GetTransactionHash = Parameters<ccc.Client["getTransaction"]>[0];
export type GetTransactionReturn = ReturnType<ccc.Client["getTransaction"]>;

export function mustPageSize(pageSize: FindCellsOnChainLimit): number {
  if (pageSize === undefined) {
    throw new Error("Expected page size");
  }
  return pageSize;
}
