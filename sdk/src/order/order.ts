import { ccc } from "@ckb-ccc/core";
import { findCells, type ScriptDeps, type ValueComponents } from "../utils/utils.ts";
import {
  attestResolvedOrderGroup,
  MasterCell,
  OrderCell,
  OrderGroup,
  validatedOrderGroup,
} from "./cells.ts";
import { Info, type InfoLike } from "./info.ts";
import type { Match } from "./matcher.ts";
import { OrderData } from "./order_data.ts";
import { Relative } from "./relative.ts";

type TransactionResponse = Awaited<ReturnType<ccc.Client["getTransaction"]>>;

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
   * to collect and a live group to cancel it (decisions amendment 52, N17).
   */
  public melt(txLike: ccc.TransactionLike, groups: OrderGroup[]): ccc.Transaction {
    const tx = ccc.Transaction.from(txLike);
    const selected = groups.map(validatedOrderGroup);
    if (selected.length === 0) {
      return tx;
    }
    for (const group of selected) {
      if (!this.isOrder(group.order.cell)) {
        throw new Error(
          `Melt order ${group.order.cell.outPoint.toHex()} does not match this order manager`,
        );
      }
    }
    tx.addCellDeps(this.cellDeps);
    for (const group of selected) {
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
      masters.map((master) => [
        master.cell.outPoint.toHex(),
        { master, orders: new Array<OrderCell>() },
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
        .map(async ({ master, orders: candidates }) =>
          this.resolveOrderGroup(client, master, candidates),
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
    return cells.flatMap((cell) => {
      const order = OrderCell.tryFrom(cell);
      return order !== undefined && this.isOrder(cell) ? [order] : [];
    });
  }

  private async findAllMasters(client: ccc.Client): Promise<MasterCell[]> {
    // An exact type search returns master cells only; the node is trusted (amendment 52).
    const cells = await findCells(client, {
      script: this.script,
      scriptType: "type",
      scriptSearchMode: "exact",
      withData: true,
    });
    return cells.map((cell) => new MasterCell(cell));
  }

  /** Resolves one master and its descendant orders into a validated order group. */
  private async resolveOrderGroup(
    client: ccc.Client,
    master: MasterCell,
    orders: OrderCell[],
  ): Promise<OrderGroup | undefined> {
    const found = await this.findOrigin(client, master.cell.outPoint);
    const order = found?.origin.resolve(orders);
    if (found === undefined || order === undefined) {
      return undefined;
    }
    const group = OrderGroup.tryFrom(master, order, found.origin, found.blockNumber);
    // A dual-ratio order, valid on chain but placed by nothing in the stack, is left to
    // whoever placed it: neither matched, estimated, shown nor melted here (52(al)).
    if (group === undefined || group.order.data.info.isDualRatio()) {
      return undefined;
    }
    return attestResolvedOrderGroup(group);
  }

  /**
   * The mint order created beside the master, read from the master's transaction: the
   * client cache first, then the node, recording the response for the next read. The
   * response's block number dates the order; an uncommitted origin has none.
   */
  private async findOrigin(
    client: ccc.Client,
    master: ccc.OutPoint,
  ): Promise<{ origin: OrderCell; blockNumber: ccc.Num | undefined } | undefined> {
    const { txHash, index: masterIndex } = master;
    const response = await cachedTransactionResponse(client, txHash);
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
    return origin === undefined
      ? undefined
      : { origin, blockNumber: response.blockNumber };
  }

  private validatedPartial({
    group,
    ckbOut,
    udtOut,
  }: Match["partials"][number]): Match["partials"][number] {
    const validated = validatedOrderGroup(group);
    const outPoint = validated.order.cell.outPoint.toHex();
    if (!this.isOrder(validated.order.cell)) {
      throw new Error(`Match order ${outPoint} does not match this order manager`);
    }
    if (ckbOut < 0n) {
      throw new Error(`Match order ${outPoint} has negative CKB output`);
    }
    if (udtOut < 0n) {
      throw new Error(`Match order ${outPoint} has negative UDT output`);
    }
    return { group: validated, ckbOut, udtOut };
  }
}

async function cachedTransactionResponse(
  client: ccc.Client,
  txHash: ccc.Hex,
): Promise<TransactionResponse | undefined> {
  // As CCC's own readers do, trust the cache only once the transaction is in a block: the
  // cache also holds what CCC records at broadcast and what a lagging node answered, and a
  // long-lived client would otherwise keep that answer for good (52(al) Grok review).
  const cached = await client.cache.getTransactionResponse(txHash);
  if (cached?.blockNumber !== undefined) {
    return cached;
  }

  const response = await client.getTransaction(txHash);
  if (response !== undefined) {
    await client.cache.recordTransactionResponses(response);
  }
  return response;
}
