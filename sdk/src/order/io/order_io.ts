import type { ccc } from "@ckb-ccc/core";
import type { OrderGroup } from "../model/cells.ts";

export function cellInputLike(cell: ccc.Cell): ccc.CellInputLike {
  return {
    outPoint: cell.outPoint,
    cellOutput: cellOutputLike(cell.cellOutput),
    outputData: cell.outputData,
  };
}

export function cellOutputLike(output: ccc.CellOutput): ccc.CellOutputLike {
  return {
    capacity: output.capacity,
    lock: output.lock,
    type: output.type ?? null,
  };
}

export function maxOrderOccupiedSize(orderPool: OrderGroup[]): number {
  let maxSize = 0;
  for (const group of orderPool) {
    maxSize = Math.max(maxSize, group.order.cell.occupiedSize);
  }
  return maxSize;
}
