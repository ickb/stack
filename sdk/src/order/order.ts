import { ccc } from "@ckb-ccc/core";
import type { ScriptDeps, ValueComponents } from "../utils/index.ts";
import {
  findAllMasters,
  findSimpleOrders,
  isMasterCell,
  isOrderCell,
  resolveOrderGroup,
} from "./io/order_scan.ts";
import { addOrderMatch, meltOrderGroups, mintOrder } from "./io/order_transaction.ts";
import type { Match } from "./matching/match_types.ts";
import type { OrderCell, OrderGroup } from "./model/cells.ts";
import { Info, type InfoLike } from "./model/info.ts";

export type { Match } from "./matching/match_types.ts";
export { OrderConversionRepresentabilityError } from "./matching/order_conversion.ts";

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
    return isOrderCell(cell, this.script, this.udtScript);
  }

  /** Returns true when the cell is a master cell for this manager's order script. */
  public isMaster(cell: ccc.Cell): boolean {
    return isMasterCell(cell, this.script);
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
    info: InfoLike,
    amounts: ValueComponents,
  ): ccc.Transaction {
    return mintOrder(this, {
      tx: ccc.Transaction.from(txLike),
      lock,
      info: Info.from(info),
      amounts,
    });
  }

  /**
   * Adds inputs and partial outputs for a chosen match.
   *
   * @throws Error if the match repeats the same order out point.
   */
  public addMatch(txLike: ccc.TransactionLike, match: Match): ccc.Transaction {
    return addOrderMatch(this, ccc.Transaction.from(txLike), match);
  }

  /**
   * Adds order groups and their master cells as melt inputs.
   *
   * @remarks Melts exactly the groups it is given: callers pass fulfilled groups
   * to collect and a live group to cancel it (decisions amendment 52, N17).
   */
  public melt(txLike: ccc.TransactionLike, groups: OrderGroup[]): ccc.Transaction {
    return meltOrderGroups(this, ccc.Transaction.from(txLike), groups);
  }

  /**
   * Finds valid order groups by scanning order cells and master cells.
   *
   * @remarks
   * Every group is resolved before the first one is yielded, so a failed
   * resolution cannot leave earlier groups observed as a complete scan. The
   * origin order lookup reads the client cache first, then fetches and records
   * the transaction response when needed. Unresolved or invalid groups are skipped.
   */
  public async *findOrders(client: ccc.Client): AsyncGenerator<OrderGroup> {
    const [simpleOrders, allMasters] = await Promise.all([
      findSimpleOrders({ client, script: this.script, udtScript: this.udtScript }),
      findAllMasters({ client, script: this.script }),
    ]);
    const rawGroups = new Map(
      allMasters.map((master) => [
        master.cell.outPoint.toHex(),
        { master, orders: new Array<OrderCell>() },
      ]),
    );

    for (const order of simpleOrders) {
      const rawGroup = rawGroups.get(order.getMaster().toHex());
      if (rawGroup === undefined) {
        continue;
      }
      rawGroup.orders.push(order);
    }

    // Each group's origin is one transaction read; resolving them together turns a book of
    // fifty orders from seconds of round trips into one.
    const resolved = await Promise.all(
      [...rawGroups.values()]
        .filter(({ orders }) => orders.length > 0)
        .map(async ({ master, orders }) =>
          resolveOrderGroup(client, master, orders, (cell) => this.isOrder(cell)),
        ),
    );
    for (const orderGroup of resolved) {
      if (orderGroup.ok) {
        yield orderGroup.group;
      }
    }
  }
}
