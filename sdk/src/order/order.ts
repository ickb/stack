import { ccc } from "@ckb-ccc/core";
import { ICKB_UDT, ORDER } from "../constants.ts";
import { findCells, headerByNumber, type ValueComponents } from "../utils/utils.ts";
import { MasterCell, OrderCell, OrderGroup } from "./cells.ts";
import { Info, type InfoLike } from "./info.ts";
import type { Match } from "./matcher.ts";
import { OrderData } from "./order_data.ts";
import { Relative } from "./relative.ts";

/** Whether the cell is an iCKB order: locked by the order script, typed by iCKB. */
export function isOrder(cell: ccc.Cell): boolean {
  return cell.cellOutput.lock.eq(ORDER) && Boolean(cell.cellOutput.type?.eq(ICKB_UDT));
}

/**
 * Adds a new order cell and its master cell to a partial transaction.
 *
 * @remarks
 * The order output is locked by the order script and typed by the iCKB
 * xUDT. The following master output is typed by the order script and locked by
 * the caller-provided lock.
 */
export function mint(
  txLike: ccc.TransactionLike,
  lock: ccc.Script,
  infoLike: InfoLike,
  { ckbValue, udtValue }: ValueComponents,
): ccc.Transaction {
  const tx = ccc.Transaction.from(txLike);
  const data = OrderData.from({
    udtValue,
    master: { type: "relative", value: Relative.create(1n) },
    info: Info.from(infoLike),
  });
  data.validate();
  if (ckbValue < 0n) {
    throw new Error("ckbValue invalid, negative");
  }

  const outputCount = tx.addOutput({ lock: ORDER, type: ICKB_UDT }, data.toBytes());
  const orderOutput = tx.outputs[outputCount - 1];
  if (orderOutput === undefined) {
    throw new Error("Failed to append order output");
  }
  orderOutput.capacity += ckbValue;
  tx.addOutput({ lock, type: ORDER });
  return tx;
}

/**
 * Adds inputs and partial outputs for a chosen match.
 */
export function addMatch(txLike: ccc.TransactionLike, match: Match): ccc.Transaction {
  const tx = ccc.Transaction.from(txLike);
  const partials = match.partials.map((partial) => validatedPartial(partial));
  let ckbDelta = 0n;
  let udtDelta = 0n;
  for (const { group, ckbOut, udtOut } of partials) {
    ckbDelta += group.order.ckbValue - ckbOut;
    udtDelta += group.order.udtValue - udtOut;
  }
  if (match.ckbDelta !== ckbDelta || match.udtDelta !== udtDelta) {
    throw new Error("Match deltas do not match partial order accounting");
  }
  if (partials.length === 0) {
    return tx;
  }

  for (const { group, ckbOut, udtOut } of partials) {
    const { order } = group;
    tx.addInput(order.cell);
    tx.addOutput(
      { lock: ORDER, type: ICKB_UDT, capacity: ckbOut },
      OrderData.from({
        udtValue: udtOut,
        // Stryker disable next-line StringLiteral: the encoder treats every type but "relative" as absolute, so the literal only satisfies the type checker.
        master: { type: "absolute", value: order.getMaster() },
        info: order.data.info,
      }).toBytes(),
    );
  }
  return tx;
}

/**
 * Adds order groups and their master cells as melt inputs.
 *
 * @remarks Melts exactly the groups it is given: callers pass fulfilled groups
 * to collect and a live group to cancel it.
 */
export function melt(txLike: ccc.TransactionLike, groups: OrderGroup[]): ccc.Transaction {
  const tx = ccc.Transaction.from(txLike);
  if (groups.length === 0) {
    return tx;
  }
  for (const group of groups) {
    if (!isOrder(group.order.cell)) {
      throw new Error(
        `Melt order ${group.order.cell.outPoint.toHex()} is not an iCKB order`,
      );
    }
  }
  for (const group of groups) {
    tx.addInput(group.order.cell);
    tx.addInput(group.master.cell);
  }
  return tx;
}

/**
 * Finds valid order groups by scanning order cells and master cells. Unresolved or
 * invalid groups are skipped.
 */
export async function findOrders(client: ccc.Client): Promise<OrderGroup[]> {
  const [orders, masters] = await Promise.all([
    findSimpleOrders(client),
    findAllMasters(client),
  ]);
  const rawGroups = new Map(
    masters.map(({ master, blockNumber }) => [
      master.cell.outPoint.toHex(),
      { master, blockNumber, orders: new Array<OrderCell>() },
    ]),
  );
  for (const order of orders) {
    rawGroups.get(order.getMaster().toHex())?.orders.push(order);
  }

  // Each group's origin is one transaction read and its mint header one header read;
  // resolving them together turns a book of fifty orders from seconds of round trips into
  // one, and the verified client shares a header among the groups minted in one block.
  const groups = await Promise.all(
    [...rawGroups.values()]
      .filter((rawGroup) => rawGroup.orders.length > 0)
      .map(async ({ master, blockNumber, orders: candidates }) =>
        resolveOrderGroup(client, master, blockNumber, candidates),
      ),
  );
  return groups.filter((group) => group !== undefined);
}

async function findSimpleOrders(client: ccc.Client): Promise<OrderCell[]> {
  const cells = await findCells(client, {
    script: ORDER,
    scriptType: "lock",
    filter: { script: ICKB_UDT },
    scriptSearchMode: "exact",
    withData: true,
  });
  return cells.flatMap(({ cell, blockNumber }) => {
    const order = OrderCell.tryFrom(cell, blockNumber);
    return order !== undefined && isOrder(cell) ? [order] : [];
  });
}

/**
 * Every master with the block that committed it, which is its mint order's block too:
 * a master is created beside its mint order and never changes until melted.
 */
async function findAllMasters(
  client: ccc.Client,
): Promise<Array<{ master: MasterCell; blockNumber: ccc.Num }>> {
  // An exact type search returns master cells only, so nothing re-filters here.
  const cells = await findCells(client, {
    script: ORDER,
    scriptType: "type",
    scriptSearchMode: "exact",
    withData: true,
  });
  return cells.map(({ cell, blockNumber }) => ({
    master: new MasterCell(cell),
    blockNumber,
  }));
}

/** Resolves one master and its descendant orders into a validated order group. */
async function resolveOrderGroup(
  client: ccc.Client,
  master: MasterCell,
  blockNumber: ccc.Num,
  orders: OrderCell[],
): Promise<OrderGroup | undefined> {
  const [origin, header] = await Promise.all([
    findOrigin(client, master.cell.outPoint, blockNumber),
    headerByNumber(client, blockNumber),
  ]);
  if (origin === undefined) {
    return undefined;
  }
  const order = origin.resolve(orders);
  if (order === undefined) {
    return undefined;
  }
  const group = OrderGroup.tryFrom(master, order, origin, header);
  // A dual-ratio order, valid on chain but placed by nothing in the stack, is left to
  // whoever placed it: neither matched, estimated, shown nor melted here.
  if (group === undefined || group.order.data.info.isDualRatio()) {
    return undefined;
  }
  return group;
}

/**
 * The mint order created beside the master, read from the master's transaction: the
 * client cache first, then the node, which records the response for the next read.
 */
async function findOrigin(
  client: ccc.Client,
  master: ccc.OutPoint,
  blockNumber: ccc.Num,
): Promise<OrderCell | undefined> {
  const { txHash, index: masterIndex } = master;
  // A cached body is trusted like the scan that found the master: an order is a node's
  // claim until the send checks every cell it spends against its creating transaction.
  const response =
    (await client.cache.getTransactionResponse(txHash)) ??
    (await client.getTransaction(txHash));
  if (response === undefined) {
    return undefined;
  }

  let origin: OrderCell | undefined;
  for (const [i, output] of [...response.transaction.outputCells].entries()) {
    const index = BigInt(i);
    if (index === masterIndex) {
      continue;
    }
    const cell = ccc.Cell.from({
      cellOutput: output.cellOutput,
      outputData: output.outputData,
      outPoint: { txHash, index },
    });
    // The mint shares the master's transaction, so the master's block dates it.
    const order = OrderCell.tryFrom(cell, blockNumber);
    if (
      order === undefined ||
      !isOrder(cell) ||
      !order.data.isMint() ||
      !order.getMaster().eq(master)
    ) {
      continue;
    }
    if (origin !== undefined) {
      // Two mint orders pointing at one master: the group is ambiguous, skip it.
      return undefined;
    }
    origin = order;
  }
  return origin;
}

function validatedPartial({
  group,
  ckbOut,
  udtOut,
}: Match["partials"][number]): Match["partials"][number] {
  const outPoint = group.order.cell.outPoint.toHex();
  if (!isOrder(group.order.cell)) {
    throw new Error(`Match order ${outPoint} is not an iCKB order`);
  }
  if (ckbOut < 0n) {
    throw new Error(`Match order ${outPoint} has negative CKB output`);
  }
  if (udtOut < 0n) {
    throw new Error(`Match order ${outPoint} has negative UDT output`);
  }
  return { group, ckbOut, udtOut };
}
