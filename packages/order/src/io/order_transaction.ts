import { ccc } from "@ckb-ccc/core";
import type { ValueComponents } from "@ickb/utils";
import type { Match } from "../matching/match_types.ts";
import { OrderGroup, validatedOrderGroup } from "../model/cells.ts";
import type { Info } from "../model/info.ts";
import { OrderData } from "../model/order_data.ts";
import { Relative } from "../model/relative.ts";
import { cellInputLike } from "./order_io.ts";
import { isOrderCell } from "./order_scan.ts";

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
  const partials = match.partials.map((partial) => assertMatchPartial(context, partial));
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
  const duplicateOutPoint = duplicatePartialOrderOutPoint(partials);
  if (duplicateOutPoint !== undefined) {
    throw new Error(`Match contains duplicate order cells: ${duplicateOutPoint}`);
  }

  const spent = new Set(tx.inputs.map((input) => input.previousOutput.toHex()));
  for (const partial of partials) {
    const outPoint = partial.group.order.cell.outPoint.toHex();
    if (spent.has(outPoint)) {
      throw new Error(`Match order ${outPoint} is already being spent`);
    }
  }

  tx.addCellDeps(cellDeps);
  for (const partial of partials) {
    const { group, ckbOut, udtOut } = partial;
    const { order } = group;
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
  const selectedGroups: OrderGroup[] = [];
  for (const group of groups) {
    const validated = validatedOrderGroup(group);
    const { order } = validated;
    if (options?.isFulfilledOnly === true && !order.isFulfilled()) {
      continue;
    }
    selectedGroups.push(validated);
  }
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
    const key = partial.group.order.cell.outPoint.toHex();
    if (outPoints.has(key)) {
      return key;
    }
    outPoints.add(key);
  }
  return undefined;
}

function assertMatchPartial(
  context: OrderTransactionContext,
  { group, ckbOut, udtOut }: MatchPartial,
): MatchPartial {
  if (!(group instanceof OrderGroup)) {
    throw new TypeError("Match partial is missing resolved order provenance");
  }
  const wrappedOrder = group.order;
  const wrappedOutPoint = wrappedOrder.cell.outPoint.toHex();
  if (ccc.hexFrom(wrappedOrder.data.toBytes()) !== wrappedOrder.cell.outputData) {
    throw new Error(`Match order ${wrappedOutPoint} does not match its cell data`);
  }

  const validatedGroup = validatedOrderGroup(group);
  const { order } = validatedGroup;
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

  return { group: validatedGroup, ckbOut, udtOut };
}

function assertOrderGroupForMelt(
  context: OrderTransactionContext,
  group: OrderGroup,
): void {
  const orderOutPoint = group.order.cell.outPoint.toHex();
  if (!isOrderCell(group.order.cell, context.script, context.udtScript)) {
    throw new Error(`Melt order ${orderOutPoint} does not match this order manager`);
  }
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
