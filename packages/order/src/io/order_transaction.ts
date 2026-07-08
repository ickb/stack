import { ccc } from "@ckb-ccc/core";
import type { ValueComponents } from "@ickb/utils";
import type { Match } from "../matching/match_types.ts";
import { OrderCell, type OrderGroup } from "../model/cells.ts";
import type { Info } from "../model/info.ts";
import { OrderData } from "../model/order_data.ts";
import { Relative } from "../model/relative.ts";
import { cellInputLike } from "./order_io.ts";
import { isMasterCell, isOrderCell } from "./order_scan.ts";

interface OrderTransactionContext {
  script: ccc.Script;
  cellDeps: ccc.CellDep[];
  udtScript: ccc.Script;
}

interface MintOrderInput {
  tx: ccc.Transaction;
  lock: ccc.Script;
  info: Info;
  amounts: ValueComponents;
}

export function mintOrder(
  context: OrderTransactionContext,
  { tx, lock, info, amounts }: MintOrderInput,
): ccc.Transaction {
  const { script, cellDeps, udtScript } = context;
  const { ckbValue, udtValue } = amounts;
  const data = OrderData.from({
    udtValue,
    master: { type: "relative", value: Relative.create(1n) },
    info,
  });
  data.validate();
  if (ckbValue < 0n) {
    throw new Error("ckbValue invalid, negative");
  }

  tx.addCellDeps(cellDeps);
  const outputCount = tx.addOutput({ lock: script, type: udtScript }, data.toBytes());
  const orderOutput = tx.outputs[outputCount - 1];
  if (orderOutput === undefined) {
    throw new Error("Failed to append order output");
  }
  orderOutput.capacity += ckbValue;
  tx.addOutput({ lock, type: script });
  return tx;
}

export function addOrderMatch(
  context: OrderTransactionContext,
  tx: ccc.Transaction,
  match: Match,
): ccc.Transaction {
  const { cellDeps, script, udtScript } = context;
  const partials = match.partials;
  if (partials.length === 0) {
    return tx;
  }
  const duplicateOutPoint = duplicatePartialOrderOutPoint(partials);
  if (duplicateOutPoint !== undefined) {
    throw new Error(`Match contains duplicate order cells: ${duplicateOutPoint}`);
  }

  tx.addCellDeps(cellDeps);
  for (const partial of partials) {
    assertMatchPartial(context, partial);
    const { order, ckbOut, udtOut } = partial;
    tx.addInput(cellInputLike(order.cell));
    tx.addOutput(
      { lock: script, type: udtScript, capacity: ckbOut },
      OrderData.from({
        udtValue: udtOut,
        master: { type: "absolute", value: order.getMaster() },
        info: order.data.info,
      }).toBytes(),
    );
  }
  return tx;
}

export function meltOrderGroups(
  context: OrderTransactionContext,
  tx: ccc.Transaction,
  groups: OrderGroup[],
  options?: { isFulfilledOnly?: boolean },
): ccc.Transaction {
  const selectedGroups =
    options?.isFulfilledOnly === true
      ? groups.filter((g) => g.order.isFulfilled())
      : groups;
  if (selectedGroups.length === 0) {
    return tx;
  }
  for (const group of selectedGroups) {
    assertOrderGroupForMelt(context, group);
  }
  assertMeltInputsUnspent(tx, selectedGroups);
  tx.addCellDeps(context.cellDeps);

  for (const group of selectedGroups) {
    tx.addInput(cellInputLike(group.order.cell));
    tx.addInput(cellInputLike(group.master.cell));
  }
  return tx;
}

type MatchPartial = Match["partials"][number];

function duplicatePartialOrderOutPoint(partials: Match["partials"]): string | undefined {
  const outPoints = new Set<string>();
  for (const partial of partials) {
    const key = partial.order.cell.outPoint.toHex();
    if (outPoints.has(key)) {
      return key;
    }
    outPoints.add(key);
  }
  return undefined;
}

function assertMatchPartial(
  context: OrderTransactionContext,
  { order, ckbOut, udtOut }: MatchPartial,
): void {
  const outPoint = order.cell.outPoint.toHex();
  if (!isOrderCell(order.cell, context.script, context.udtScript)) {
    throw new Error(`Match order ${outPoint} does not match this order manager`);
  }
  if (ckbOut < 0n) {
    throw new Error(`Match order ${outPoint} has negative CKB output`);
  }
  if (udtOut < 0n) {
    throw new Error(`Match order ${outPoint} has negative UDT output`);
  }

  OrderCell.mustFrom(order.cell);
  if (ccc.hexFrom(order.data.toBytes()) !== order.cell.outputData) {
    throw new Error(`Match order ${outPoint} does not match its cell data`);
  }
}

function assertOrderGroupForMelt(
  context: OrderTransactionContext,
  group: OrderGroup,
): void {
  const orderOutPoint = group.order.cell.outPoint.toHex();
  const masterOutPoint = group.master.cell.outPoint.toHex();
  if (!isOrderCell(group.order.cell, context.script, context.udtScript)) {
    throw new Error(`Melt order ${orderOutPoint} does not match this order manager`);
  }
  if (!isMasterCell(group.master.cell, context.script)) {
    throw new Error(`Melt master ${masterOutPoint} does not match this order manager`);
  }
  group.validate();
}

function assertMeltInputsUnspent(tx: ccc.Transaction, groups: OrderGroup[]): void {
  const spent = new Set(tx.inputs.map((input) => input.previousOutput.toHex()));
  const selected = new Set<string>();
  for (const group of groups) {
    for (const [label, outPoint] of [
      ["Melt order", group.order.cell.outPoint],
      ["Melt master", group.master.cell.outPoint],
    ] as const) {
      const key = outPoint.toHex();
      if (selected.has(key)) {
        throw new Error(`${label} ${key} is duplicated`);
      }
      selected.add(key);
      if (spent.has(key)) {
        throw new Error(`${label} ${key} is already being spent`);
      }
    }
  }
}
