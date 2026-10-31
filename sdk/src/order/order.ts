import { ccc } from "@ckb-ccc/core";
import { findCells, type ScriptDeps, type ValueComponents } from "../utils/utils.ts";
import { MasterCell, OrderCell, OrderGroup } from "./cells.ts";
import { Info, type InfoLike } from "./info.ts";
import type { Match } from "./matcher.ts";
import { OrderData } from "./order_data.ts";
import { Relative } from "./relative.ts";

/**
 * Builds and scans iCKB Stack order cells for one order script deployment.
 */
export class OrderManager implements ScriptDeps {
  /** Order lock script this manager scans and builds for. */
  public readonly script: ccc.Script;
  /** Cell deps required to execute the order script. */
  public readonly cellDeps: ccc.CellDep[];
  /** UDT type script accepted by this order market. */
  public readonly udtScript: ccc.Script;

  /**
   * Creates an order manager for one order script, its cell deps, and UDT type.
   */
  constructor(script: ccc.Script, cellDeps: ccc.CellDep[], udtScript: ccc.Script) {
    this.script = script;
    this.cellDeps = cellDeps;
    this.udtScript = udtScript;
  }

  /** Returns true when the cell is an order cell for this manager's scripts. */
  public isOrder(cell: ccc.Cell): boolean {
    return (
      cell.cellOutput.lock.eq(this.script) &&
      Boolean(cell.cellOutput.type?.eq(this.udtScript))
    );
  }

  /**
   * Adds a new order cell and its master cell to a partial transaction.
   *
   * @remarks
   * The order output is locked by the order script and typed by the configured
   * UDT. The following master output is typed by the order script and locked by
   * the caller-provided lock.
   */
  public mint(
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

    tx.addCellDeps(this.cellDeps);
    const outputCount = tx.addOutput(
      { lock: this.script, type: this.udtScript },
      data.toBytes(),
    );
    const orderOutput = tx.outputs[outputCount - 1];
    if (orderOutput === undefined) {
      throw new Error("Failed to append order output");
    }
    orderOutput.capacity += ckbValue;
    tx.addOutput({ lock, type: this.script });
    return tx;
  }

  /**
   * Adds inputs and partial outputs for a chosen match.
   */
  public addMatch(txLike: ccc.TransactionLike, match: Match): ccc.Transaction {
    const tx = ccc.Transaction.from(txLike);
    const partials = match.partials.map((partial) => this.validatedPartial(partial));
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

    tx.addCellDeps(this.cellDeps);
    for (const { group, ckbOut, udtOut } of partials) {
      const { order } = group;
      tx.addInput(order.cell);
      tx.addOutput(
        { lock: this.script, type: this.udtScript, capacity: ckbOut },
        OrderData.from({
          udtValue: udtOut,
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
  public melt(txLike: ccc.TransactionLike, groups: OrderGroup[]): ccc.Transaction {
    const tx = ccc.Transaction.from(txLike);
    if (groups.length === 0) {
      return tx;
    }
    for (const group of groups) {
      if (!this.isOrder(group.order.cell)) {
        throw new Error(
          `Melt order ${group.order.cell.outPoint.toHex()} does not match this order manager`,
        );
      }
    }
    tx.addCellDeps(this.cellDeps);
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
  public async findOrders(client: ccc.Client): Promise<OrderGroup[]> {
    const [orders, masters] = await Promise.all([
      this.findSimpleOrders(client),
      this.findAllMasters(client),
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

    // Each group's origin is one transaction read; resolving them together turns a book of
    // fifty orders from seconds of round trips into one.
    const groups = await Promise.all(
      [...rawGroups.values()]
        .filter((rawGroup) => rawGroup.orders.length > 0)
        .map(async ({ master, blockNumber, orders: candidates }) =>
          this.resolveOrderGroup(client, master, blockNumber, candidates),
        ),
    );
    return groups.filter((group) => group !== undefined);
  }

  private async findSimpleOrders(client: ccc.Client): Promise<OrderCell[]> {
    const cells = await findCells(client, {
      script: this.script,
      scriptType: "lock",
      filter: { script: this.udtScript },
      scriptSearchMode: "exact",
      withData: true,
    });
    return cells.flatMap(({ cell }) => {
      const order = OrderCell.tryFrom(cell);
      return order !== undefined && this.isOrder(cell) ? [order] : [];
    });
  }

  /**
   * Every master with the block that committed it, which is its mint order's block too:
   * a master is created beside its mint order and never changes until melted, so this
   * dates how long the order has been on the book.
   */
  private async findAllMasters(
    client: ccc.Client,
  ): Promise<Array<{ master: MasterCell; blockNumber: ccc.Num }>> {
    // An exact type search returns master cells only, so nothing re-filters here.
    const cells = await findCells(client, {
      script: this.script,
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
  private async resolveOrderGroup(
    client: ccc.Client,
    master: MasterCell,
    blockNumber: ccc.Num,
    orders: OrderCell[],
  ): Promise<OrderGroup | undefined> {
    const origin = await this.findOrigin(client, master.cell.outPoint);
    const order = origin?.resolve(orders);
    if (origin === undefined || order === undefined) {
      return undefined;
    }
    const group = OrderGroup.tryFrom(master, order, origin, blockNumber);
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
  private async findOrigin(
    client: ccc.Client,
    master: ccc.OutPoint,
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
      const order = OrderCell.tryFrom(cell);
      if (
        order === undefined ||
        !this.isOrder(cell) ||
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

  private validatedPartial({
    group,
    ckbOut,
    udtOut,
  }: Match["partials"][number]): Match["partials"][number] {
    const outPoint = group.order.cell.outPoint.toHex();
    if (!this.isOrder(group.order.cell)) {
      throw new Error(`Match order ${outPoint} does not match this order manager`);
    }
    if (ckbOut < 0n) {
      throw new Error(`Match order ${outPoint} has negative CKB output`);
    }
    if (udtOut < 0n) {
      throw new Error(`Match order ${outPoint} has negative UDT output`);
    }
    return { group, ckbOut, udtOut };
  }
}
