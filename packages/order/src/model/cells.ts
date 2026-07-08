import { ccc } from "@ckb-ccc/core";
import type { ValueComponents } from "@ickb/utils";
import { OrderData } from "./order_data.ts";

/**
 * Constructor tuple for the decoded cell, order payload, value totals, progress, and optional maturity estimate.
 *
 * @public
 */
export type OrderCellConstructorArgs = [
  cell: ccc.Cell,
  data: OrderData,
  ckbUnoccupied: ccc.FixedPoint,
  absTotal: ccc.Num,
  absProgress: ccc.Num,
  maturity: bigint | undefined,
];

/**
 * Represents a parsed order cell on the blockchain.
 *
 * Implements `ValueComponents` to expose the cell's raw data and its
 * value breakdown (CKB and UDT).
 *
 * @public
 */
export class OrderCell implements ValueComponents {
  /** Raw live cell that carries the order lock and UDT type. */
  public cell: ccc.Cell;
  /** Decoded order payload from `cell.outputData`. */
  public data: OrderData;
  /** CKB capacity available for matching after occupied capacity is reserved. */
  public ckbUnoccupied: ccc.FixedPoint;
  /** Absolute total order value in the order's comparison units. */
  public absTotal: ccc.Num;
  /** Absolute matched progress in the order's comparison units. */
  public absProgress: ccc.Num;
  /** Estimated completion maturity, `0n` for complete orders, or `undefined` when unavailable. */
  public maturity: bigint | undefined;

  /**
   * Creates an instance of OrderCell.
   *
   * @param cell - The raw cell fetched from the chain.
   * @param data - Decoded order data with parameters (rates, directions, etc.).
   * @param ckbUnoccupied - Amount of CKB in this cell not used in state rent.
   * @param absTotal - Absolute total value of this order (in base units).
   * @param absProgress - Absolute amount filled so far (in base units).
   * @param maturity - Estimated completion time supplied by higher-level state:
   *   - `bigint` Unix timestamp in milliseconds when estimated,
   *   - `0n` when already completed,
   *   - `undefined` when no estimate is available. Core parsing uses
   *     `undefined` for in-progress or dual orders and `0n` for completed directional orders.
   */
  constructor(
    ...[
      cell,
      data,
      ckbUnoccupied,
      absTotal,
      absProgress,
      maturity,
    ]: OrderCellConstructorArgs
  ) {
    this.cell = cell;
    this.data = data;
    this.ckbUnoccupied = ckbUnoccupied;
    this.absTotal = absTotal;
    this.absProgress = absProgress;
    this.maturity = maturity;
  }

  /**
   * Gets the order CKB amount.
   *
   * @returns The CKB amount as a `ccc.FixedPoint`.
   */
  public get ckbValue(): ccc.FixedPoint {
    return this.cell.cellOutput.capacity;
  }

  /**
   * Gets the order UDT amount.
   *
   * @returns The UDT amount as a `ccc.FixedPoint`.
   */
  public get udtValue(): ccc.FixedPoint {
    return this.data.udtValue;
  }

  /**
   * Attempts to parse an OrderCell from a raw cell.
   *
   * Returns `undefined` if parsing or validation fails.
   *
   * @param cell - The raw chain cell to convert.
   * @returns An `OrderCell` instance or `undefined`.
   */
  public static tryFrom(cell: ccc.Cell): OrderCell | undefined {
    try {
      return OrderCell.mustFrom(cell);
    } catch {
      return undefined;
    }
  }

  /**
   * Parses and validates a raw cell as OrderCell.
   *
   * Throws if the cell is invalid or data validation fails.
   *
   * @param cell - The raw chain cell to convert.
   * @returns A new `OrderCell` instance.
   * @throws When decoding or validation fails.
   */
  public static mustFrom(cell: ccc.Cell): OrderCell {
    // Decode and validate the order payload
    const data = OrderData.decode(cell.outputData);
    data.validate();

    const udtValue = data.udtValue;
    const ckbUnoccupied = cell.capacityFree;
    const { ckbToUdt, udtToCkb } = data.info;
    const isCkb2Udt = data.info.isCkb2Udt();
    const isUdt2Ckb = data.info.isUdt2Ckb();
    const isDualRatio = isCkb2Udt && isUdt2Ckb;

    // Compute total values in base units
    const ckb2UdtValue = isCkb2Udt
      ? ckbUnoccupied * ckbToUdt.ckbScale + udtValue * ckbToUdt.udtScale
      : 0n;
    const udt2CkbValue = isUdt2Ckb
      ? ckbUnoccupied * udtToCkb.ckbScale + udtValue * udtToCkb.udtScale
      : 0n;

    const absTotal = absoluteOrderTotal(ckb2UdtValue, udt2CkbValue, data.info);
    const absProgress = absoluteOrderProgress({
      absTotal,
      ckbUnoccupied,
      isCkb2Udt,
      isDualRatio,
      udtScale: ckbToUdt.udtScale,
      udtValue,
      udtToCkbCkbScale: udtToCkb.ckbScale,
    });

    // Maturity: undefined if in-progress or dual; zero if complete
    const maturity = isDualRatio || absTotal !== absProgress ? undefined : 0n;

    return new OrderCell(cell, data, ckbUnoccupied, absTotal, absProgress, maturity);
  }

  /**
   * Checks if the order is is dual ratio.
   *
   * @returns True if the order is dual ratio (liquidity provider), otherwise false.
   */
  public isDualRatio(): boolean {
    return this.data.info.isDualRatio();
  }

  /**
   * Checks whether the CKB-to-UDT side is enabled and has nonzero inventory.
   *
   * @remarks Executable-match checks for fee, minimum output, and ratio bounds happen in `OrderMatcher`.
   */
  public isCkb2UdtMatchable(): boolean {
    return this.data.info.isCkb2Udt() && this.ckbUnoccupied > 0n;
  }

  /**
   * Checks whether the UDT-to-CKB side is enabled and has nonzero inventory.
   *
   * @remarks Executable-match checks for fee, minimum output, and ratio bounds happen in `OrderMatcher`.
   */
  public isUdt2CkbMatchable(): boolean {
    return this.data.info.isUdt2Ckb() && this.data.udtValue > 0n;
  }

  /** Returns true when either side is enabled and has nonzero inventory. */
  public isMatchable(): boolean {
    return this.isCkb2UdtMatchable() || this.isUdt2CkbMatchable();
  }

  /**
   * Checks if the order is fulfilled.
   *
   * @returns True if the order is fulfilled (not matchable), otherwise false.
   */
  public isFulfilled(): boolean {
    return !this.isMatchable();
  }

  /**
   * Retrieves the master out point of the order.
   * @returns The master out point associated with the order.
   */
  public getMaster(): ccc.OutPoint {
    return this.data.getMaster(this.cell.outPoint);
  }

  /**
   * Validates a descendant order against this origin order.
   *
   * @remarks
   * This confusion-attack guard requires the same order script, UDT type,
   * master, and info, while forbidding lower total value or lower progress.
   * See {@link https://github.com/ickb/whitepaper/issues/19}.
   */
  public validate(descendant: OrderCell): void {
    // Same cell, nothing to check
    if (this.cell.outPoint.eq(descendant.cell.outPoint)) {
      return;
    }

    if (!this.cell.cellOutput.lock.eq(descendant.cell.cellOutput.lock)) {
      throw new Error("Order script different");
    }

    const udt = this.cell.cellOutput.type;
    if (udt === undefined || descendant.cell.cellOutput.type?.eq(udt) !== true) {
      throw new Error("UDT type is different");
    }

    if (!descendant.getMaster().eq(this.getMaster())) {
      throw new Error("Master is different");
    }

    if (!this.data.info.eq(descendant.data.info)) {
      throw new Error("Info is different");
    }

    if (this.absTotal > descendant.absTotal) {
      throw new Error("Total value is lower than the original one");
    }

    if (this.absProgress > descendant.absProgress) {
      throw new Error("Progress is lower than the original one");
    }
  }

  /**
   * Checks if the descendant order is valid against this order.
   * @param descendant - The descendant order to validate.
   * @returns True if the descendant is valid, otherwise false.
   */
  public isValid(descendant: OrderCell): boolean {
    try {
      this.validate(descendant);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Resolves the best valid descendant order.
   *
   * @remarks
   * Resolution prefers greater progress, then a mint order over a non-mint order
   * at equal progress. Equal-progress non-identical candidates with the same
   * mint status are ambiguous and resolve to `undefined`.
   */
  public resolve(descendants: OrderCell[]): OrderCell | undefined {
    let resolution: OrderResolution | undefined;
    for (const descendant of descendants) {
      if (!this.isValid(descendant)) {
        continue;
      }

      resolution = betterOrderResolution(resolution, descendant);
    }

    if (resolution?.isAmbiguous === true) {
      return undefined;
    }

    return resolution?.order;
  }
}

interface OrderResolution {
  isAmbiguous: boolean;
  order: OrderCell;
}

function absoluteOrderTotal(
  ckb2UdtValue: bigint,
  udt2CkbValue: bigint,
  info: OrderData["info"],
): bigint {
  if (ckb2UdtValue === 0n) {
    return udt2CkbValue;
  }
  if (udt2CkbValue === 0n) {
    return ckb2UdtValue;
  }

  const { ckbToUdt, udtToCkb } = info;
  return (
    (ckb2UdtValue * udtToCkb.ckbScale * udtToCkb.udtScale +
      udt2CkbValue * ckbToUdt.ckbScale * ckbToUdt.udtScale) >>
    1n
  );
}

function absoluteOrderProgress(options: {
  absTotal: bigint;
  ckbUnoccupied: bigint;
  isCkb2Udt: boolean;
  isDualRatio: boolean;
  udtScale: bigint;
  udtToCkbCkbScale: bigint;
  udtValue: bigint;
}): bigint {
  if (options.isDualRatio) {
    return options.absTotal;
  }
  if (options.isCkb2Udt) {
    return options.udtValue * options.udtScale;
  }
  return options.ckbUnoccupied * options.udtToCkbCkbScale;
}

function betterOrderResolution(
  current: OrderResolution | undefined,
  candidate: OrderCell,
): OrderResolution {
  if (current === undefined || current.order.absProgress < candidate.absProgress) {
    return { isAmbiguous: false, order: candidate };
  }
  if (current.order.absProgress !== candidate.absProgress) {
    return current;
  }
  if (current.order.cell.outPoint.eq(candidate.cell.outPoint)) {
    return current;
  }
  if (candidate.data.isMint() && !current.order.data.isMint()) {
    return { isAmbiguous: false, order: candidate };
  }
  if (!candidate.data.isMint() && current.order.data.isMint()) {
    return current;
  }
  return { ...current, isAmbiguous: true };
}

/**
 * Represents a master cell
 *
 * @public
 */
export class MasterCell implements ValueComponents {
  /** Raw live master cell that anchors an order group. */
  public cell: ccc.Cell;

  /**
   * Gets the UDT value of the cell.
   *
   * For a Master Cell, the UDT amount is always zero.
   *
   * @returns The UDT amount as a `ccc.FixedPoint` (0n).
   */
  public readonly udtValue = 0n;

  /**
   * Creates an instance of MasterCell.
   * @param cell - The ccc.Cell instance to be wrapped by the MasterCell.
   */
  constructor(cell: ccc.Cell) {
    this.cell = cell;
  }

  /**
   * Gets the CKB value of the cell.
   *
   * @returns The total CKB amount as a `ccc.FixedPoint`.
   */
  public get ckbValue(): ccc.FixedPoint {
    return this.cell.cellOutput.capacity;
  }

  /**
   * Creates a MasterCell instance from a cell-like object.
   * @param cellLike - An object that can be converted to a ccc.Cell.
   * @returns A new instance of MasterCell.
   */
  public static from(cellLike: ccc.CellLike): MasterCell {
    return new MasterCell(ccc.Cell.from(cellLike));
  }

  /**
   * Validates the MasterCell against an OrderCell.
   * @param order - The OrderCell to validate against.
   * @throws Error if the order script is different or if the master is different.
   */
  public validate(order: OrderCell): void {
    if (this.cell.cellOutput.type?.eq(order.cell.cellOutput.lock) !== true) {
      throw new Error("Order script different");
    }

    if (!order.getMaster().eq(this.cell.outPoint)) {
      throw new Error("Master is different");
    }
  }
}

/**
 * Represents a group of orders associated with a master cell.
 *
 * @public
 */
export class OrderGroup implements ValueComponents {
  /** Master cell that authorizes and anchors the current order. */
  public master: MasterCell;
  /** Current resolved order cell. */
  public order: OrderCell;
  /** Origin order used to validate descendant progress and identity. */
  public origin: OrderCell;

  /**
   * Creates an instance of OrderGroup.
   * @param master - The master cell associated with the order group.
   * @param order - The order within the group.
   * @param origin - The original order associated with the group.
   */
  constructor(master: MasterCell, order: OrderCell, origin: OrderCell) {
    this.master = master;
    this.order = order;
    this.origin = origin;
  }

  /**
   * Gets the CKB value of the group.
   *
   * @returns The total CKB amount as a `ccc.FixedPoint`, which is the sum of the CKB values of the order cell and the master cell.
   */
  public get ckbValue(): ccc.FixedPoint {
    return this.order.cell.cellOutput.capacity + this.master.cell.cellOutput.capacity;
  }

  /**
   * Gets the UDT value of the group.
   *
   * @returns The UDT amount as a `ccc.FixedPoint`, derived from the order cell.
   */
  public get udtValue(): ccc.FixedPoint {
    return this.order.data.udtValue;
  }

  /**
   * Tries to create an OrderGroup from the provided parameters.
   * @param master - The master cell.
   * @param order - The order within the group.
   * @param origin - The original order.
   * @returns An OrderGroup instance or undefined if creation fails.
   */
  public static tryFrom(
    master: MasterCell,
    order: OrderCell,
    origin: OrderCell,
  ): OrderGroup | undefined {
    const og = new OrderGroup(master, order, origin);
    if (og.isValid()) {
      return og;
    }
    return undefined;
  }

  /**
   * Validates the order group against its master and origin orders.
   * @throws Will throw an error if validation fails.
   */
  public validate(): void {
    this.master.validate(this.order);
    this.origin.validate(this.order);
  }

  /**
   * Checks if the order group is valid.
   * @returns True if the order group is valid, otherwise false.
   */
  public isValid(): boolean {
    try {
      this.validate();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Checks if the specified lock is the owner of the master cell.
   *
   * @param locks - The locks to check ownership against.
   * @returns True if the lock is the owner, otherwise false.
   */
  public isOwner(...locks: ccc.Script[]): boolean {
    const lock = this.master.cell.cellOutput.lock;
    return locks.some((l) => lock.eq(l));
  }
}
