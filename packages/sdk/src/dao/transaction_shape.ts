import type { ccc } from "@ckb-ccc/core";

export function cellInputLikeFrom(cell: ccc.Cell): ccc.CellInputLike {
  return {
    outPoint: cell.outPoint,
    cellOutput: cellOutputLikeFrom(cell.cellOutput),
    outputData: cell.outputData,
  };
}

export function cellOutputLikeFrom(cellOutput: ccc.CellOutput): ccc.CellOutputLike {
  return {
    capacity: cellOutput.capacity,
    lock: cellOutput.lock,
    ...(cellOutput.type === undefined ? {} : { type: cellOutput.type }),
  };
}
