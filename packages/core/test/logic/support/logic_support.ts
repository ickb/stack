import { ccc } from "@ckb-ccc/core";
import {
  byte32FromByte,
  headerLike,
  script,
  StubClient,
  transactionWithHeader,
} from "@ickb/testkit";
import { ReceiptData } from "../../../src/entities.ts";
import { IckbUdt } from "../../../src/udt.ts";

export const LOGIC_MANAGER_DEPOSIT_SUITE = "LogicManager.deposit";

export function testClient(): ccc.Client {
  return new StubClient();
}

export function noCellsOnChain(): ReturnType<ccc.Client["findCellsOnChain"]> {
  return cellsOf([]);
}

export function receiptPair(logic: ccc.Script, lock: ccc.Script): [ccc.Cell, ccc.Cell] {
  return [receiptCell("44", logic, lock), receiptCell("55", logic, lock)];
}

export function receiptPhase2Capacity(lock: ccc.Script): ccc.FixedPoint {
  const plainCellCapacity =
    BigInt(
      ccc.CellAny.from({
        cellOutput: { lock },
        outputData: "0x",
      }).occupiedSize,
    ) * ccc.One;
  return plainCellCapacity + IckbUdt.minimumXudtCellCapacity(lock) + ccc.One;
}

async function* cellsOf(cells: readonly ccc.Cell[]): AsyncGenerator<ccc.Cell> {
  await Promise.resolve();
  yield* cells;
}

function receiptCell(txHashByte: string, logic: ccc.Script, lock: ccc.Script): ccc.Cell {
  return ccc.Cell.from({
    outPoint: { txHash: byte32FromByte(txHashByte), index: 0n },
    cellOutput: { capacity: ccc.fixedPointFrom(100082), lock, type: logic },
    outputData: ReceiptData.from({
      depositQuantity: 1,
      depositAmount: ccc.fixedPointFrom(100000),
    }).toBytes(),
  });
}

export { byte32FromByte, headerLike, script, StubClient, transactionWithHeader };
