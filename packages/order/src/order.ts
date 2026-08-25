import { ccc } from "@ckb-ccc/core";
import {
  defaultCellPageSize,
  defaultScanBudget,
  type ExchangeRatio,
  type PagedScanBudget,
  type ScriptDeps,
  type ValueComponents,
} from "@ickb/utils";
import {
  findAllMasters,
  findSimpleOrders,
  isMasterCell,
  isOrderCell,
  resolveOrderGroup,
  type OrderGroupSkipReason,
} from "./io/order_scan.ts";
import { addOrderMatch, meltOrderGroups, mintOrder } from "./io/order_transaction.ts";
import { ceilDiv, quotePreservingRatio } from "./matching/order_conversion.ts";
import {
  bestMatch,
  type BestMatchOptions,
  type Match,
  type MatchSearchResult,
} from "./matching/order_matching.ts";
import type { OrderCell, OrderGroup } from "./model/cells.ts";
import { Info, type InfoLike } from "./model/info.ts";
import { Ratio } from "./model/ratio.ts";

export type { OrderGroupSkipReason } from "./io/order_scan.ts";
export { OrderConversionRepresentabilityError } from "./matching/order_conversion.ts";
export type {
  BestMatchOptions,
  Match,
  MatchDiagnostics,
  MatchDirectionDiagnostics,
  MatchSearchMode,
  MatchSearchPhase,
  MatchSearchResult,
} from "./matching/order_matching.ts";

/**
 * Builds and scans iCKB Stack order cells for one order script deployment.
 *
 * @public
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
   * Computes the output-side amount, CKB fee, and order info for a new order.
   *
   * @remarks
   * The returned `Info` preserves the quoted amount after fee adjustment so the
   * minted order records the executable limit price.
   */
  public static convert(
    isCkb2Udt: boolean,
    midpoint: ExchangeRatio,
    amounts: ValueComponents,
    options?: {
      fee?: ccc.Num;
      feeBase?: ccc.Num;
      ckbMinMatchLog?: number;
    },
  ): { convertedAmount: ccc.FixedPoint; ckbFee: ccc.FixedPoint; info: Info } {
    const fee = options?.fee ?? 0n;
    // Generic denominator for callers that pass a fee without a scale; Stack's
    // own default pair is owned publicly by the SDK, not by this entity.
    const feeBase = options?.feeBase ?? 100000n;
    const base = Ratio.from(midpoint);
    const amount = isCkb2Udt ? amounts.ckbValue : amounts.udtValue;
    const { aScale, bScale } = base.feeAdjustedScales(isCkb2Udt, fee, feeBase);
    const convertedAmount = ceilDiv(amount * aScale, bScale);
    let ckbFee = 0n;

    if (amount > 0n && fee !== 0n) {
      ckbFee = isCkb2Udt
        ? amount - base.convert(false, convertedAmount, false)
        : base.convert(false, amount, false) - convertedAmount;
    }

    const info = Info.create(
      isCkb2Udt,
      quotePreservingRatio(amount, convertedAmount, isCkb2Udt),
      options?.ckbMinMatchLog,
    );
    return { convertedAmount, ckbFee, info };
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
   * Finds a bounded best executable match for validated, resolved order groups.
   *
   * @remarks
   * Groups preserve the genuine mint origin used by the resolver's confusion
   * heuristic. Raw `OrderCell`s are intentionally not accepted for matching.
   * A complete result proves the atomic optimum; an incomplete result carries
   * the best exactly evaluated candidate without claiming global optimality.
   */
  public static bestMatch(
    orderPool: OrderGroup[],
    allowance: ValueComponents,
    exchangeRate: ExchangeRatio,
    options?: BestMatchOptions,
  ): MatchSearchResult {
    return bestMatch(orderPool, allowance, exchangeRate, options);
  }

  /**
   * Adds order groups and their master cells as melt inputs.
   *
   * @param options - Set `isFulfilledOnly` to skip groups whose current order is still matchable.
   */
  public melt(
    txLike: ccc.TransactionLike,
    groups: OrderGroup[],
    options?: { isFulfilledOnly?: boolean },
  ): ccc.Transaction {
    return meltOrderGroups(this, ccc.Transaction.from(txLike), groups, options);
  }

  /**
   * Finds valid order groups by scanning order cells and master cells.
   *
   * @remarks
   * `pageSize` is the per-scan RPC/indexer page size, not a total cap: the order
   * and master scans share one `budget`, which defaults to a bound that fails
   * instead of yielding partial order state. Every group is resolved before the
   * first one is yielded, so a failed resolution cannot leave earlier groups
   * observed as a complete scan. The origin order lookup reads the client cache
   * first, then fetches and records the transaction response when needed.
   * `onSkippedGroup` reports unresolved or invalid groups without aborting the
   * scan.
   */
  public async *findOrders(
    client: ccc.Client,
    options?: {
      onChain?: boolean;
      pageSize?: number;
      budget?: PagedScanBudget;
      onSkippedGroup?: (reason: OrderGroupSkipReason) => void;
    },
  ): AsyncGenerator<OrderGroup> {
    const { onChain, pageSize, budget } = orderScanBounds(options);
    const [simpleOrders, allMasters] = await Promise.all([
      findSimpleOrders({
        client,
        script: this.script,
        udtScript: this.udtScript,
        onChain,
        pageSize,
        budget,
      }),
      findAllMasters({ client, script: this.script, onChain, pageSize, budget }),
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
        options?.onSkippedGroup?.("missing-master");
        continue;
      }
      rawGroup.orders.push(order);
    }

    const foundGroups: OrderGroup[] = [];
    for (const { master, orders } of rawGroups.values()) {
      if (orders.length === 0) {
        continue;
      }
      const orderGroup = await resolveOrderGroup(client, master, orders, (cell) =>
        this.isOrder(cell),
      );
      if (!orderGroup.ok) {
        options?.onSkippedGroup?.(orderGroup.reason);
        continue;
      }
      foundGroups.push(orderGroup.group);
    }
    for (const group of foundGroups) {
      yield group;
    }
  }
}

/** Resolves the scan mode, page size, and budget shared by the order and master scans. */
function orderScanBounds(options?: {
  onChain?: boolean;
  pageSize?: number;
  budget?: PagedScanBudget;
}): { onChain: boolean; pageSize: number; budget: PagedScanBudget } {
  const pageSize = options?.pageSize ?? defaultCellPageSize;
  return {
    onChain: options?.onChain ?? true,
    pageSize,
    // One scan for order cells and one for their master cells.
    budget: options?.budget ?? defaultScanBudget({ pageSize }),
  };
}
