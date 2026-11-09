import type { ccc } from "@ckb-ccc/core";
import type { ValueComponents } from "../utils/utils.ts";
import { OrderData } from "./order_data.ts";

/**
 * Represents a parsed order cell on the blockchain.
 *
 * Implements `ValueComponents` to expose the cell's raw data and its
 * value breakdown (CKB and UDT).
 */
export class OrderCell implements ValueComponents {
  /** Raw live cell that carries the order lock and UDT type. */
  public readonly cell: ccc.Cell;
  /** Decoded order payload from `cell.outputData`. */
  public readonly data: OrderData;
  /** CKB capacity available for matching after occupied capacity is reserved. */
  public readonly ckbUnoccupied: ccc.FixedPoint;
  /** Absolute total order value in the order's comparison units. */
  public readonly absTotal: ccc.Num;
  /** Absolute matched progress in the order's comparison units. */
  public readonly absProgress: ccc.Num;
  /**
   * The block that committed this cell, as the scan reported it. A fill replaces the order
   * cell, so this is the last fill's block, or the mint's when unfilled.
   */
  public readonly blockNumber: ccc.Num;

  constructor({
    cell,
    data,
    ckbUnoccupied,
    absTotal,
    absProgress,
    blockNumber,
  }: {
    cell: ccc.Cell;
    data: OrderData;
    ckbUnoccupied: ccc.FixedPoint;
    absTotal: ccc.Num;
    absProgress: ccc.Num;
    blockNumber: ccc.Num;
  }) {
    this.cell = cell;
    this.data = data;
    this.ckbUnoccupied = ckbUnoccupied;
    this.absTotal = absTotal;
    this.absProgress = absProgress;
    this.blockNumber = blockNumber;
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
   * @param blockNumber - The block that committed the cell.
   * @returns An `OrderCell` instance or `undefined`.
   */
  public static tryFrom(cell: ccc.Cell, blockNumber: ccc.Num): OrderCell | undefined {
    try {
      return OrderCell.mustFrom(cell, blockNumber);
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
   * @param blockNumber - The block that committed the cell.
   * @returns A new `OrderCell` instance.
   * @throws When decoding or validation fails.
   */
  public static mustFrom(cell: ccc.Cell, blockNumber: ccc.Num): OrderCell {
    let data: OrderData;
    try {
      data = OrderData.decode(cell.outputData);
      data.validate();
    } catch (error) {
      throw new Error(`Invalid order payload at ${cell.outPoint.toHex()}`, {
        cause: error,
      });
    }

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
    // What the order already holds of its output side; a dual-ratio order is complete.
    let absProgress = ckbUnoccupied * udtToCkb.ckbScale;
    if (isDualRatio) {
      absProgress = absTotal;
    } else if (isCkb2Udt) {
      absProgress = udtValue * ckbToUdt.udtScale;
    }

    return new OrderCell({
      cell,
      data,
      ckbUnoccupied,
      absTotal,
      absProgress,
      blockNumber,
    });
  }

  /**
   * Checks whether the CKB-to-UDT side is enabled and has nonzero inventory.
   *
   * @remarks Executable-match checks for fee, minimum output, and ratio bounds happen during matching.
   */
  public isCkb2UdtMatchable(): boolean {
    return this.data.info.isCkb2Udt() && this.ckbUnoccupied > 0n;
  }

  /**
   * Checks whether the UDT-to-CKB side is enabled and has nonzero inventory.
   *
   * @remarks Executable-match checks for fee, minimum output, and ratio bounds happen during matching.
   */
  public isUdt2CkbMatchable(): boolean {
    return this.data.info.isUdt2Ckb() && this.data.udtValue > 0n;
  }

  /** Returns true when either side is enabled and has nonzero inventory. */
  public isMatchable(): boolean {
    return this.isCkb2UdtMatchable() || this.isUdt2CkbMatchable();
  }

  /**
   * Retrieves the master out point of the order.
   * @returns The master out point associated with the order.
   */
  public getMaster(): ccc.OutPoint {
    return this.data.getMaster(this.cell.outPoint);
  }

  /**
   * Whether `descendant` can be this origin order's live continuation.
   *
   * @remarks
   * This confusion-attack guard requires the same order script, UDT type,
   * master, and info, while forbidding lower total value or lower progress.
   * See {@link https://github.com/ickb/whitepaper/issues/19}.
   */
  public isValid(descendant: OrderCell): boolean {
    const udt = this.cell.cellOutput.type;
    return (
      this.data.isMint() &&
      this.cell.cellOutput.lock.eq(descendant.cell.cellOutput.lock) &&
      udt !== undefined &&
      descendant.cell.cellOutput.type?.eq(udt) === true &&
      descendant.getMaster().eq(this.getMaster()) &&
      this.data.info.eq(descendant.data.info) &&
      this.absTotal <= descendant.absTotal &&
      this.absProgress <= descendant.absProgress
    );
  }

  /**
   * Resolves the best valid descendant order.
   *
   * @remarks
   * The genuine mint origin is the immutable validation baseline. Resolution
   * prefers greater progress and then greater total value; candidate identity is
   * irrelevant. Equal-score non-mint candidates are ambiguous, while the mint
   * origin wins an equal-score tie when it is still live.
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

function betterOrderResolution(
  current: OrderResolution | undefined,
  candidate: OrderCell,
): OrderResolution {
  if (current === undefined || compareOrderScore(current.order, candidate) < 0) {
    return { isAmbiguous: false, order: candidate };
  }
  if (compareOrderScore(current.order, candidate) > 0) {
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

function compareOrderScore(left: OrderCell, right: OrderCell): number {
  if (left.absProgress !== right.absProgress) {
    return left.absProgress < right.absProgress ? -1 : 1;
  }
  if (left.absTotal !== right.absTotal) {
    return left.absTotal < right.absTotal ? -1 : 1;
  }
  return 0;
}

/**
 * Represents a master cell
 */
export class MasterCell {
  /** Raw live master cell that anchors an order group. */
  public readonly cell: ccc.Cell;

  /**
   * Creates an instance of MasterCell.
   * @param cell - The ccc.Cell instance to be wrapped by the MasterCell.
   */
  constructor(cell: ccc.Cell) {
    this.cell = cell;
  }

  /** Whether this master anchors `order`: its type is the order script and the order names it. */
  public anchors(order: OrderCell): boolean {
    return (
      this.cell.cellOutput.type?.eq(order.cell.cellOutput.lock) === true &&
      order.getMaster().eq(this.cell.outPoint)
    );
  }
}

/**
 * Represents a group of orders associated with a master cell.
 */
export class OrderGroup implements ValueComponents {
  /** Master cell that authorizes and anchors the current order. */
  public readonly master: MasterCell;
  /** Current resolved order cell. */
  public readonly order: OrderCell;
  /** Origin order used to validate descendant progress and identity. */
  public readonly origin: OrderCell;

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
   * Whether the master anchors the origin and the order continues it. A continuation
   * shares the origin's lock and master, so the master anchors the order as well.
   */
  public isValid(): boolean {
    return this.master.anchors(this.origin) && this.origin.isValid(this.order);
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
