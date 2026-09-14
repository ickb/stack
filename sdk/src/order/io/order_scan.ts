import { ccc } from "@ckb-ccc/core";
import { findCells } from "../../utils/index.ts";
import {
  attestResolvedOrderGroup,
  MasterCell,
  OrderCell,
  OrderGroup,
} from "../model/cells.ts";
import { cellOutputLike } from "./order_io.ts";

/**
 * Reason an observed order/master candidate could not form a valid group.
 */
export type OrderGroupSkipReason =
  /** Order cell points to a master out point that was not found in the master scan. */
  | "missing-master"
  /** Master creation transaction did not contain an origin order. */
  | "missing-origin"
  /** Master creation transaction contained more than one matching origin order. */
  | "ambiguous-origin"
  /** No descendant order was valid for the origin order. */
  | "missing-order"
  /** More than one equally good descendant order was valid for the origin order. */
  | "ambiguous-order"
  /** Master, origin, and resolved order failed final group validation. */
  | "invalid-group";

type FindOriginResult =
  | { ok: true; origin: OrderCell }
  | { ok: false; reason: "missing-origin" | "ambiguous-origin" };

type ResolveOrderGroupResult =
  | { ok: true; group: OrderGroup }
  | {
      ok: false;
      reason: Exclude<OrderGroupSkipReason, "missing-master">;
    };

type TransactionResponse = Awaited<ReturnType<ccc.Client["getTransaction"]>>;

interface OriginOrderAtOptions {
  transaction: NonNullable<TransactionResponse>["transaction"];
  txHash: ccc.Hex;
  index: bigint;
  master: ccc.OutPoint;
  isOrder: (cell: ccc.Cell) => boolean;
}

interface FindCellsOptions {
  client: ccc.Client;
  script: ccc.Script;
}

interface FindSimpleOrdersOptions extends FindCellsOptions {
  udtScript: ccc.Script;
}

/** Finds simple order cells before grouping them with masters. */
export async function findSimpleOrders({
  client,
  script,
  udtScript,
}: FindSimpleOrdersOptions): Promise<OrderCell[]> {
  const orders: OrderCell[] = [];
  for (const cell of await findCells(client, {
    script,
    scriptType: "lock",
    filter: { script: udtScript },
    scriptSearchMode: "exact",
    withData: true,
  })) {
    const order = OrderCell.tryFrom(cell);
    if (order !== undefined && isOrderCell(cell, script, udtScript)) {
      orders.push(order);
    }
  }

  return orders;
}

/** Finds master cells for the order script. */
export async function findAllMasters({
  client,
  script,
}: FindCellsOptions): Promise<MasterCell[]> {
  // An exact type search returns master cells only; the node is trusted (amendment 52).
  return (
    await findCells(client, {
      script,
      scriptType: "type",
      scriptSearchMode: "exact",
      withData: true,
    })
  ).map((cell) => new MasterCell(cell));
}

/** Resolves one master and its descendant orders into a validated order group. */
export async function resolveOrderGroup(
  client: ccc.Client,
  master: MasterCell,
  orders: OrderCell[],
  isOrder: (cell: ccc.Cell) => boolean,
): Promise<ResolveOrderGroupResult> {
  const origin = await findOrigin(client, master.cell.outPoint, isOrder);
  if (!origin.ok) {
    return origin;
  }

  const order = origin.origin.resolve(orders);
  if (order === undefined) {
    return {
      ok: false,
      reason: orders.some((candidate) => origin.origin.isValid(candidate))
        ? "ambiguous-order"
        : "missing-order",
    };
  }

  const group = OrderGroup.tryFrom(master, order, origin.origin);
  return group === undefined
    ? { ok: false, reason: "invalid-group" }
    : { ok: true, group: attestResolvedOrderGroup(group) };
}

/** Checks the order-cell lock/type shape for one order deployment. */
export function isOrderCell(
  cell: ccc.Cell,
  script: ccc.Script,
  udtScript: ccc.Script,
): boolean {
  return cell.cellOutput.lock.eq(script) && Boolean(cell.cellOutput.type?.eq(udtScript));
}

/** Checks the master-cell type shape for one order deployment. */
export function isMasterCell(cell: ccc.Cell, script: ccc.Script): boolean {
  return Boolean(cell.cellOutput.type?.eq(script));
}

async function findOrigin(
  client: ccc.Client,
  master: ccc.OutPoint,
  isOrder: (cell: ccc.Cell) => boolean,
): Promise<FindOriginResult> {
  const { txHash, index: mIndex } = master;
  const response = await cachedTransactionResponse(client, txHash);
  if (response === undefined) {
    return { ok: false, reason: "missing-origin" };
  }

  let origin: OrderCell | undefined;
  for (let index = 0n; index < BigInt(response.transaction.outputs.length); index++) {
    if (index === mIndex) {
      continue;
    }

    const candidate = originOrderAt({
      transaction: response.transaction,
      txHash,
      index,
      master,
      isOrder,
    });
    if (candidate === undefined) {
      continue;
    }
    if (origin !== undefined) {
      return { ok: false, reason: "ambiguous-origin" };
    }
    origin = candidate;
  }
  return origin === undefined
    ? { ok: false, reason: "missing-origin" }
    : { ok: true, origin };
}

async function cachedTransactionResponse(
  client: ccc.Client,
  txHash: ccc.Hex,
): Promise<TransactionResponse | undefined> {
  const cached = await client.cache.getTransactionResponse(txHash);
  if (cached !== undefined) {
    return cached;
  }

  const response = await client.getTransaction(txHash);
  if (response !== undefined) {
    await client.cache.recordTransactionResponses(response);
  }
  return response;
}

function originOrderAt({
  transaction,
  txHash,
  index,
  master,
  isOrder,
}: OriginOrderAtOptions): OrderCell | undefined {
  const output = transaction.getOutput(index);
  if (output === undefined) {
    return undefined;
  }

  const cell = ccc.Cell.from({
    cellOutput: cellOutputLike(output.cellOutput),
    outputData: output.outputData,
    outPoint: { txHash, index },
  });
  const order = OrderCell.tryFrom(cell);
  return order !== undefined &&
    isOrder(cell) &&
    order.data.isMint() &&
    order.getMaster().eq(master)
    ? order
    : undefined;
}
