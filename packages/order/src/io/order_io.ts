import type { ccc } from "@ckb-ccc/core";

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

export function maxOrderOccupiedSize(orderPool: Array<{ cell: ccc.Cell }>): number {
  let maxSize = 0;
  for (const order of orderPool) {
    maxSize = Math.max(maxSize, order.cell.occupiedSize);
  }
  return maxSize;
}
