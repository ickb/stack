import { ccc } from "@ckb-ccc/core";
import {
  byte32FromByte,
  committedTransactionResponse,
  StubClient,
  type StubCell,
} from "@ickb/testkit";
import { ORDER } from "../../../../src/constants.ts";
import type {
  GetTransactionHash,
  GetTransactionReturn,
} from "../../fixtures/order_constants.ts";

export const OWNER_LOCK = ccc.Script.from({
  codeHash: byte32FromByte("44"),
  hashType: "type",
  args: "0x",
});

export function masterCell(outPoint: ccc.OutPointLike, type = ORDER): ccc.Cell {
  return ccc.Cell.from({
    outPoint,
    cellOutput: {
      capacity: ccc.fixedPointFrom(61),
      lock: OWNER_LOCK,
      type,
    },
    outputData: "0x",
  });
}

export function originLookupClient({
  liveOrder,
  liveMaster,
  originMasterTxHash,
  originTransaction,
}: {
  liveOrder: ccc.Cell;
  liveMaster: ccc.Cell;
  originMasterTxHash: ccc.Hex;
  originTransaction: ccc.Transaction;
}): ccc.Client {
  return new StubClient({
    cache: new ccc.ClientCacheMemory(),
    cells: (query): readonly StubCell[] => [
      query.script_type === "lock" ? liveOrder : liveMaster,
    ],
    getTransaction: async (txHash: GetTransactionHash): GetTransactionReturn => {
      await Promise.resolve();
      return txHash === originMasterTxHash
        ? transactionResponse(originTransaction)
        : undefined;
    },
  });
}

export function transactionResponse(tx: ccc.Transaction): ccc.ClientTransactionResponse {
  return committedTransactionResponse(tx);
}

export function transactionWithOutputs(cells: ccc.Cell[]): ccc.Transaction {
  const tx = ccc.Transaction.default();
  for (const cell of cells) {
    tx.outputs.push(cell.cellOutput);
    tx.outputsData.push(cell.outputData);
  }
  return tx;
}

export function dummyCell(byte: string, lock: ccc.Script, type: ccc.Script): ccc.Cell {
  return ccc.Cell.from({
    outPoint: { txHash: byte32FromByte(byte), index: 0n },
    cellOutput: {
      capacity: ccc.fixedPointFrom(61),
      lock,
      type,
    },
    outputData: "0x",
  });
}
