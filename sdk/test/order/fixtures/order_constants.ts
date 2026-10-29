import type { ccc } from "@ckb-ccc/core";

export const ORDER_MATCHER_SUITE = "OrderMatcher";
export const ORDER_CELL_RESOLVE_SUITE = "OrderCell.resolve";
export const ORDER_MANAGER_FIND_ORDERS_SUITE = "OrderManager.findOrders";
export const NO_CELLS: readonly ccc.Cell[] = [];

export type GetTransactionHash = Parameters<ccc.Client["getTransaction"]>[0];
export type GetTransactionReturn = ReturnType<ccc.Client["getTransaction"]>;
