import { ccc } from "@ckb-ccc/core";
import { isPlainCapacityCell } from "@ickb/utils";

const FIND_CELLS_PAGE_SIZE = 400;

export async function collectCapacityCells(
  signer: Pick<ccc.SignerCkbPrivateKey, "findCellsOnChain">,
): Promise<ccc.Cell[]> {
  const cells: ccc.Cell[] = [];

  for await (const cell of signer.findCellsOnChain(
    {
      scriptLenRange: [0n, 1n],
      outputDataLenRange: [0n, 1n],
    },
    true,
    "asc",
    FIND_CELLS_PAGE_SIZE,
  )) {
    if (!isPlainCapacityCell(cell)) {
      continue;
    }

    cells.push(cell);
  }

  return cells;
}
